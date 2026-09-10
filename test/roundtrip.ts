/**
 * round-trip 测试：用写入器生成带图 xlsx -> 用读取器解析回来 -> 校验图片落点与元数据
 * 运行：npm run test:roundtrip
 */
import JSZip from 'jszip'
import { buildXlsxBytes } from '../src/lib/excel-write'
import type { OutSheet } from '../src/lib/excel-write'
import { parseWorkbookFile, extractDispImgId } from '../src/lib/excel-read'
import { cellKey } from '../src/lib/types'
import { toBitableValue } from '../src/lib/value-convert'

/* 1x1 红色 PNG */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

function png(name: string) {
  return { name, ext: 'png', bytes: new Uint8Array(Buffer.from(PNG_B64, 'base64')) }
}

/** 造一个指定像素尺寸的 PNG（只改 IHDR，够探测用） */
function pngSized(name: string, w: number, h: number) {
  const b = Buffer.from(PNG_B64, 'base64')
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  return { name, ext: 'png', bytes: new Uint8Array(b), width: w, height: h }
}

let failed = 0
function ok(cond: boolean, label: string, extra?: unknown) {
  if (cond) {
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    console.log(`  ✗ ${label}`, extra === undefined ? '' : JSON.stringify(extra))
  }
}

const sheets: OutSheet[] = [
  {
    name: '员工档案',
    headers: ['姓名', '部门', '头像', '入职日期'],
    rows: [
      ['张三', '生产部', null, '2024-01-15'],
      ['李四', '质量部', null, '2023-07-01'],
    ],
    images: [{ row: 1, col: 2, img: png('zhangsan.png') }],
  },
  {
    name: '设备台账',
    headers: ['设备编号', '照片', '状态'],
    rows: [
      ['EQ-001', null, '正常'],
      ['EQ-002', null, '维修中'],
    ],
    images: [{ row: 2, col: 1, img: png('eq002.png') }],
  },
]

async function checkMode(mode: 'dispimg' | 'float') {
  console.log(`\n=== 模式：${mode} ===`)
  const bytes = await buildXlsxBytes(sheets, { imageMode: mode })
  const zip = await JSZip.loadAsync(bytes)

  const names = Object.keys(zip.files)
  ok(names.some((n) => /^xl\/media\/image\d+\.png$/.test(n)), '媒体文件已写入 xl/media/', names.filter((n) => n.startsWith('xl/media')))
  ok(!!zip.file('[Content_Types].xml'), '[Content_Types].xml 存在')

  const ct = await zip.file('[Content_Types].xml')!.async('string')
  ok(/Extension="png"/.test(ct), 'Content_Types 声明了 png')

  /* ---- ZIP 结构必须符合 OOXML 规范顺序（WPS 对乱序包会丢 cellimages）---- */
  ok(names[0] === '[Content_Types].xml', '[Content_Types].xml 是压缩包第一个条目', names[0])
  ok(names.includes('_rels/') && names.includes('xl/'), '含显式目录条目（_rels/、xl/）', names.filter((n) => n.endsWith('/')))
  const iCt = names.indexOf('xl/cellimages.xml')
  const iMedia = names.findIndex((n) => /^xl\/media\//.test(n))
  if (mode === 'dispimg') {
    ok(iCt > 0 && (iMedia < 0 || iCt < iMedia + 999), 'cellimages.xml 排在 xl/ 组内（不是包末尾）', { iCt, iMedia, last: names[names.length - 1] })
  }

  if (mode === 'float') {
    ok(!!zip.file('xl/drawings/drawing1.xml'), '生成 xl/drawings/drawing1.xml')
    ok(!!zip.file('xl/drawings/drawing2.xml'), '生成 xl/drawings/drawing2.xml')
    ok(!!zip.file('xl/drawings/_rels/drawing1.xml.rels'), '生成 drawing1 rels')
    ok(/drawing\+xml/.test(ct), 'Content_Types 声明了 drawing')
    const d1 = await zip.file('xl/drawings/drawing1.xml')!.async('string')
    ok(/<xdr:from><xdr:col>2<\/xdr:col>/.test(d1), 'drawing1 锚定到第 3 列（col=2）', d1.slice(0, 220))
    ok(/<xdr:row>1<\/xdr:row>/.test(d1), 'drawing1 锚定到第 2 行（row=1）')
    const s1 = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    ok(/<drawing r:id="rId\d+"\/>/.test(s1), 'sheet1.xml 挂载了 drawing')
    ok(/xmlns:r=/.test(s1.match(/<worksheet\b[^>]*>/)?.[0] ?? ''), 'worksheet 声明了 r 命名空间')
  } else {
    ok(!!zip.file('xl/cellimages.xml'), '生成 xl/cellimages.xml')
    ok(!!zip.file('xl/_rels/cellimages.xml.rels'), '生成 cellimages rels')
    ok(/cellimage\+xml/.test(ct), 'Content_Types 声明了 cellimage')

    const ci = await zip.file('xl/cellimages.xml')!.async('string')
    ok(/name="ID_[0-9A-F]{32}"/.test(ci), 'cellimages 里带 ID_xxx 名称', ci.slice(0, 260))
    ok(/www\.wps\.cn\/officeDocument\/2017\/etCustomData/.test(ci), 'cellimages 使用 WPS etCustomData 命名空间')
    ok(!/<a:ext cx="0" cy="0"\/>/.test(ci), 'cellimages 的 a:ext 不是 0×0（否则 WPS 拒绝渲染）')
    ok(/<a:ext cx="\d+" cy="\d+"\/>/.test(ci), 'cellimages 的 a:ext 带真实尺寸')

    const ciRels = await zip.file('xl/_rels/cellimages.xml.rels')!.async('string')
    ok(/Target="media\/image\d+\.png"/.test(ciRels), 'cellimages rels 指向 media/imageN.png（相对 xl/）', ciRels)

    const s1 = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    // 真实 WPS 写法：<f>_xlfn.DISPIMG("ID_xxx",1)</f><v>=DISPIMG("ID_xxx",1)</v>
    ok(
      /<f>_xlfn\.DISPIMG\(&quot;ID_[0-9A-F]{32}&quot;,1\)<\/f>/.test(s1),
      'DISIMG 公式带 _xlfn. 前缀',
      s1.match(/<c r="C2"[\s\S]{0,200}/)?.[0],
    )
    ok(
      /<v>=DISPIMG\(&quot;ID_[0-9A-F]{32}&quot;,1\)<\/v>/.test(s1),
      'DISIMG 单元格 <v> 带公式文本缓存值（不能是空串）',
      s1.match(/<c r="C2"[\s\S]{0,200}/)?.[0],
    )
    ok(!/<f>DISPIMG\(/.test(s1), '不存在缺少 _xlfn. 前缀的旧写法')

    const wbrels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
    ok(/cellimages\.xml/.test(wbrels), 'workbook.xml.rels 登记了 cellimages')
    ok(/wps\.cn\/officeDocument\/2020\/cellImage/.test(wbrels), 'cellimages 关系类型为 WPS cellImage')
  }

  /* ---------- 读回来 ---------- */
  const file = new File([bytes as unknown as BlobPart], 'test.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const parsed = await parseWorkbookFile(file)
  ok(parsed.sheets.length === 2, '解析出 2 个工作表', parsed.sheets.map((s) => s.name))
  ok(parsed.sheets[0].name === '员工档案' && parsed.sheets[1].name === '设备台账', '工作表名称保持一致')

  const s1 = parsed.sheets[0]
  ok(s1.columns.map((c) => c.header).join(',') === '姓名,部门,头像,入职日期', '表头正确', s1.columns.map((c) => c.header))
  const avatarCol = s1.columns.find((c) => c.header === '头像')
  ok(!!avatarCol && avatarCol.mediaCount === 1, '「头像」列识别到 1 张图片', avatarCol?.mediaCount)
  ok(!!avatarCol && avatarCol.targetFieldType === 17, '「头像」列默认类型为附件(17)', avatarCol?.targetFieldType)
  const media1 = s1.mediaByCell.get(cellKey(1, 2))
  ok(!!media1 && media1.length === 1, '图片落在「张三」行的头像单元格', media1?.map((f) => f.name))
  ok(media1?.[0]?.type === 'image/png', '图片 MIME 正确', media1?.[0]?.type)
  ok((media1?.[0]?.size ?? 0) > 0, '图片二进制非空', media1?.[0]?.size)
  ok(s1.mediaByCell.get(cellKey(2, 2)) === undefined, '「李四」行没有图片')

  const s2 = parsed.sheets[1]
  const photoCol = s2.columns.find((c) => c.header === '照片')
  ok(!!photoCol && photoCol.mediaCount === 1, '「设备台账」的「照片」列识别到 1 张图', photoCol?.mediaCount)
  ok(s2.mediaByCell.get(cellKey(2, 1))?.length === 1, '图片落在 EQ-002 行的照片单元格')
  ok(s2.mediaByCell.get(cellKey(1, 1)) === undefined, 'EQ-001 行没有图片')

  const rowsText = parsed.sheets[0].matrix.slice(1).map((r) => r.map((v) => (v === null ? '' : String(v))))
  ok(rowsText[0][0] === '张三' && rowsText[0][1] === '生产部', '文本单元格值回读正确', rowsText[0])
  ok(!!rowsText[1][3] && rowsText[1][3].length > 0, '日期单元格有值', rowsText[1])
  return parsed
}

/* --------------- 图片尺寸：默认原图原尺寸 / 指定则等比缩放 --------------- */

async function checkImageSize() {
  console.log('\n=== 图片尺寸 ===')
  const sized: OutSheet[] = [
    {
      name: 'S',
      headers: ['图'],
      rows: [[null]],
      images: [{ row: 1, col: 0, img: pngSized('wide.png', 400, 200) }],
    },
  ]

  // 默认：不传 imageSizePx → 原图原尺寸，且保持 2:1 宽高比
  const nat = await buildXlsxBytes(sized, { imageMode: 'float' })
  const z1 = await JSZip.loadAsync(nat)
  const d1 = await z1.file('xl/drawings/drawing1.xml')!.async('string')
  const m1 = d1.match(/<xdr:ext cx="(\d+)" cy="(\d+)"\/>/)
  const cx1 = Number(m1?.[1] ?? 0)
  const cy1 = Number(m1?.[2] ?? 0)
  ok(cx1 === 400 * 9525, '默认导出用原图宽度（400px → 3810000 EMU）', cx1)
  ok(cy1 === 200 * 9525, '默认导出用原图高度（200px → 1905000 EMU）', cy1)

  // 指定 96：等比缩放到长边 96px（比例 2:1 保持）
  const sc = await buildXlsxBytes(sized, { imageMode: 'float', imageSizePx: 96 })
  const z2 = await JSZip.loadAsync(sc)
  const d2 = await z2.file('xl/drawings/drawing1.xml')!.async('string')
  const m2 = d2.match(/<xdr:ext cx="(\d+)" cy="(\d+)"\/>/)
  const cx2 = Number(m2?.[1] ?? 0)
  const cy2 = Number(m2?.[2] ?? 0)
  ok(cx2 === 96 * 9525, '指定边长后宽边缩放到 96px', cx2)
  ok(cy2 === 48 * 9525, '指定边长后窄边等比缩放为 48px', cy2)

  // DISPIMG 模式也必须吃 imageSizePx —— 图片尺寸选项已提到与「全部图片都导出」同级，
  // 两种嵌图方式都要生效，否则 WPS 模式下勾了尺寸却没反应。
  const disp = await buildXlsxBytes(sized, { imageMode: 'dispimg', imageSizePx: 96 })
  const z3 = await JSZip.loadAsync(disp)
  const cells3 = await z3.file('xl/cellimages.xml')!.async('string')
  const ext3 = cells3.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/)
  const dcx = Number(ext3?.[1] ?? 0)
  const dcy = Number(ext3?.[2] ?? 0)
  ok(dcx === 96 * 9525, 'DISPIMG 模式下宽边同样缩放到 96px', dcx)
  ok(dcy === 48 * 9525, 'DISPIMG 模式下窄边同样等比缩放到 48px', dcy)
}

/* --------- 空白工作表：不进入导入列表 --------- */

function checkBlankSheetSkip() {
  console.log('\n=== 空白工作表跳过 ===')
  const mk = (name: string, cols: number, rows: number) => ({ name, colCount: cols, totalDataRows: rows })
  const isBlank = (s: { colCount: number; totalDataRows: number }) => s.colCount === 0 || s.totalDataRows === 0

  const all = [mk('数据', 3, 10), mk('Sheet2', 0, 0), mk('Sheet3', 0, 0), mk('只有表头', 2, 0)]
  const live = all.filter((s) => !isBlank(s))
  const blank = all.filter(isBlank)

  ok(live.length === 1 && live[0].name === '数据', '只有有内容的 sheet 进入映射区', live.map((s) => s.name))
  ok(blank.length === 3, '空列 / 空行 / 两者皆空的 sheet 都被判定为空白', blank.map((s) => s.name))
  ok(blank.some((s) => s.name === 'Sheet2') && blank.some((s) => s.name === 'Sheet3'), 'Sheet2 / Sheet3 被跳过')
  ok(blank.some((s) => s.name === '只有表头'), '只有表头没有数据行的 sheet 也算空白')

  // 有列但没数据 → 没有可导入的记录
  ok(isBlank({ colCount: 5, totalDataRows: 0 }), '有 5 列但 0 数据行 → 跳过')
  // 无列但有数据 → 没有可映射字段
  ok(isBlank({ colCount: 0, totalDataRows: 100 }), '有 100 行但 0 列 → 跳过')
  ok(!isBlank({ colCount: 1, totalDataRows: 1 }), '1 列 1 行 → 保留')
}

/* --------- 多图分列：照片 / 照片2 / 照片3（附件字段内多张图各占一列） --------- */

async function checkMultiImageColumns() {
  console.log('\n=== 多图分列 ===')

  // 模拟 exporter 在 allImages = true 时的列布局：
  // 「照片」列 3 张图 -> 照片 / 照片2 / 照片3
  const sheet: OutSheet = {
    name: '设备台账',
    headers: ['设备编号', '照片', '照片2', '照片3', '照片(附件名)'],
    rows: [
      ['EQ-001', null, null, null, 'a.png\nb.png\nc.png'],
      ['EQ-002', null, null, null, 'd.png'],
    ],
    images: [
      { row: 1, col: 1, img: png('a.png') },
      { row: 1, col: 2, img: png('b.png') },
      { row: 1, col: 3, img: png('c.png') },
      { row: 2, col: 1, img: png('d.png') },
    ],
  }

  const bytes = await buildXlsxBytes([sheet], { imageMode: 'float' })
  const zip = await JSZip.loadAsync(bytes)
  const d1 = await zip.file('xl/drawings/drawing1.xml')!.async('string')

  // 同一行的第 2、3 张图必须锚定到相邻的列（col=2 / col=3）
  const anchors = [...d1.matchAll(/<xdr:from><xdr:col>(\d+)<\/xdr:col>[^<]*<xdr:colOff>\d+<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row>/g)].map(
    (m) => ({ col: Number(m[1]), row: Number(m[2]) }),
  )
  ok(anchors.length === 4, '4 张图都生成了锚点', anchors)
  ok(
    anchors.some((a) => a.row === 1 && a.col === 1) &&
      anchors.some((a) => a.row === 1 && a.col === 2) &&
      anchors.some((a) => a.row === 1 && a.col === 3),
    '同一行的 3 张图分别落在第 2/3/4 列（照片 / 照片2 / 照片3）',
    anchors,
  )
  ok(anchors.some((a) => a.row === 2 && a.col === 1), '第二行只有 1 张图，落在「照片」列')

  // 回读：三列都应被识别为附件列
  const file = new File([bytes as unknown as BlobPart], 'multi.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const parsed = await parseWorkbookFile(file)
  const headers = parsed.sheets[0].columns.map((c) => c.header)
  ok(
    headers.join(',') === '设备编号,照片,照片2,照片3,照片(附件名)',
    '多图分列后表头为 照片 / 照片2 / 照片3',
    headers,
  )
  ok(parsed.sheets[0].mediaByCell.get(cellKey(1, 1))?.length === 1, '第一行的第 1 张图在「照片」列')
  ok(parsed.sheets[0].mediaByCell.get(cellKey(1, 2))?.length === 1, '第一行的第 2 张图在「照片2」列')
  ok(parsed.sheets[0].mediaByCell.get(cellKey(1, 3))?.length === 1, '第一行的第 3 张图在「照片3」列')
}

/* --------- 单选 / 多选写值：必须带选项 id，只传文本会被静默丢弃 --------- */

function checkSelectValue() {
  console.log('\n=== 单选 / 多选写值 ===')

  const options = new Map<string, string>([
    ['生产部', 'optA'],
    ['质量部', 'optB'],
  ])

  const single = toBitableValue(3, '生产部', { media: [], options })
  ok(single.ok, '单选转换成功')
  ok(
    single.ok && typeof single.value === 'object' && (single.value as { id?: string }).id === 'optA',
    '单选值带选项 id（{ id, text }）',
    single.ok ? single.value : single.reason,
  )
  ok(
    single.ok && (single.value as { text?: string }).text === '生产部',
    '单选值同时带 text',
    single.ok ? single.value : single.reason,
  )

  const multi = toBitableValue(4, '生产部,质量部', { media: [], options })
  ok(multi.ok, '多选转换成功')
  const arr = multi.ok ? (multi.value as { id: string }[]) : []
  ok(arr.length === 2, '多选拆成 2 个值', arr)
  ok(arr.every((v) => !!v.id), '多选每一项都带选项 id', arr)

  // 拿不到选项映射时退回纯文本，至少不丢数据
  const fallback = toBitableValue(3, '未知部门', { media: [] })
  ok(fallback.ok && fallback.value === '未知部门', '没有选项映射时退回纯文本', fallback.ok ? fallback.value : fallback.reason)

  // 空值不写
  ok(!toBitableValue(3, '', { media: [], options }).ok, '空值不产生写入')
}

async function main() {
  console.log('extractDispImgId 自检')
  ok(extractDispImgId('DISPIMG("ID_8805AC7ED61347F68868D9FEB2B1289C",1)') === 'ID_8805AC7ED61347F68868D9FEB2B1289C', '能解析 DISPIMG 的 ID')
  ok(extractDispImgId('_xlfn.DISPIMG("ID_8805AC7ED61347F68868D9FEB2B1289C",1)') === 'ID_8805AC7ED61347F68868D9FEB2B1289C', '能解析 _xlfn.DISPIMG 的 ID')
  ok(extractDispImgId('=DISPIMG("ID_8805AC7ED61347F68868D9FEB2B1289C",1)') === 'ID_8805AC7ED61347F68868D9FEB2B1289C', '能解析 <v> 缓存文本里的 ID')
  ok(extractDispImgId('SUM(A1:A2)') === null, '普通公式返回 null')

  await checkMode('dispimg')
  await checkMode('float')
  await checkImageSize()
  await checkMultiImageColumns()
  checkSelectValue()
  checkBlankSheetSkip()

  console.log(`\n${failed === 0 ? '全部通过 ✅' : `失败 ${failed} 项 ❌`}`)
  process.exit(failed === 0 ? 0 : 1)
}

void main()
