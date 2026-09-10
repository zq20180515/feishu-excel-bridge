import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { attr, basename, dirname, findAll, escapeRegExp, parseRelationships, resolveZipPath } from './xml'
import { normalizeImageExt } from './field-meta'

const EMU_PER_PX = 9525

/** 单元格默认行高（pt）与列宽（字符数），图片不缩放时按原图比例微调 */
const ROW_H_PT_MAX = 409
const COL_W_MAX = 255

export type OutImage = {
  name: string
  /** png / jpg / gif ... */
  ext: string
  bytes: Uint8Array
  /** 原图像素尺寸（有则用于「原图原尺寸」导出，避免拉伸变形） */
  width?: number
  height?: number
}

export type OutCellImage = {
  /** 0-based 行号（含表头行，即表头是 0） */
  row: number
  /** 0-based 列号 */
  col: number
  img: OutImage
}

export type OutSheet = {
  name: string
  headers: string[]
  rows: (string | number | boolean | null)[][]
  /** 需要嵌到单元格里的图片 */
  images: OutCellImage[]
}

export type ImageMode = 'dispimg' | 'float'

export type WriteOptions = {
  /**
   * dispimg = WPS 专有的「嵌入单元格图片」=DISPIMG("ID_xxx",1)，图片跟随单元格，不会浮在上层
   * float   = 标准 OOXML 浮动图片，锚定到单元格（Excel / WPS / LibreOffice 通用）
   */
  imageMode: ImageMode
  /**
   * float 模式下图片显示边长（px）。
   * 不传 = 原图原尺寸（按图片自身像素尺寸渲染）；传值 = 等比缩放到该边长。
   */
  imageSizePx?: number
  /**
   * 原图无法解析像素尺寸时的兜底边长（px）。默认 160。
   */
  fallbackImagePx?: number
}

/* ------------------------------- 工具 ------------------------------- */

function safeSheetName(name: string, used: Set<string>): string {
  let base = String(name || 'Sheet').replace(/[:\\/?*[\]]/g, '_').trim() || 'Sheet'
  if (base.length > 31) base = base.slice(0, 31)
  let candidate = base
  let i = 2
  while (used.has(candidate.toLowerCase())) {
    const suffix = `_${i++}`
    candidate = base.slice(0, 31 - suffix.length) + suffix
  }
  used.add(candidate.toLowerCase())
  return candidate
}

function makeDispImgId(): string {
  const g = globalThis.crypto
  if (g && typeof g.randomUUID === 'function') return `ID_${g.randomUUID().replace(/-/g, '').toUpperCase()}`
  let s = ''
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16)
  return `ID_${s.toUpperCase()}`
}

function expandRef(ws: XLSX.WorkSheet, row: number, col: number): void {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1')
  if (row < range.s.r) range.s.r = row
  if (col < range.s.c) range.s.c = col
  if (row > range.e.r) range.e.r = row
  if (col > range.e.c) range.e.c = col
  ws['!ref'] = XLSX.utils.encode_range(range)
}

async function readZipString(zip: JSZip, path: string): Promise<string | null> {
  const f = zip.file(path)
  if (!f) return null
  return await f.async('string')
}

/* --------------------------- 图片像素尺寸探测 --------------------------- */
/* 只解析文件头，不依赖 canvas / Image，因此在 Node 测试与浏览器里行为一致 */

function readU32BE(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
}

function readU16BE(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1]
}

function probePng(b: Uint8Array): { width: number; height: number } | null {
  // 89 50 4E 47 0D 0A 1A 0A | len(4) "IHDR"(4) w(4) h(4)
  if (b.length < 24) return null
  if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null
  const width = readU32BE(b, 16)
  const height = readU32BE(b, 20)
  if (!width || !height) return null
  return { width, height }
}

function probeGif(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 10) return null
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return null
  const width = b[6] | (b[7] << 8)
  const height = b[8] | (b[9] << 8)
  if (!width || !height) return null
  return { width, height }
}

function probeJpeg(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let o = 2
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) {
      o++
      continue
    }
    const marker = b[o + 1]
    // SOF0..SOF15（排除 DHT=0xC4 / JPG=0xC8 / DAC=0xCC）
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = readU16BE(b, o + 5)
      const width = readU16BE(b, o + 7)
      if (!width || !height) return null
      return { width, height }
    }
    // 其它标记：跳过该段
    if (o + 3 >= b.length) break
    const segLen = readU16BE(b, o + 2)
    if (segLen < 2) break
    o += 2 + segLen
  }
  return null
}

function probeBmp(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 26) return null
  if (b[0] !== 0x42 || b[1] !== 0x4d) return null
  const width = b[18] | (b[19] << 8) | (b[20] << 16) | (b[21] << 24)
  const height = b[22] | (b[23] << 8) | (b[24] << 16) | (b[25] << 24)
  if (!width || !height) return null
  return { width: Math.abs(width), height: Math.abs(height) }
}

/** 读取图片原始像素尺寸；无法识别时返回 null（EMF/WMF/SVG 等矢量格式） */
export function probeImageSize(img: OutImage): { width: number; height: number } | null {
  if (img.width && img.height) return { width: img.width, height: img.height }
  const b = img.bytes
  if (!b || b.length < 12) return null
  const ext = normalizeImageExt(img.ext)
  if (ext === 'png') return probePng(b)
  if (ext === 'jpg') return probeJpeg(b)
  if (ext === 'gif') return probeGif(b)
  if (ext === 'bmp') return probeBmp(b)
  // 扩展名不准时按魔数兜底
  return probePng(b) ?? probeJpeg(b) ?? probeGif(b) ?? probeBmp(b)
}

function insertBeforeClosing(xml: string, closeTag: string, payload: string): string {
  const idx = xml.lastIndexOf(closeTag)
  if (idx < 0) return xml
  return xml.slice(0, idx) + payload + xml.slice(idx)
}

/* --------------------------- Content Types --------------------------- */

function patchContentTypes(xml: string, imageExts: string[], overrides: string[]): string {
  let out = xml
  const existing = new Set(findAll(out, 'Default').map((t) => (attr(t, 'Extension') || '').toLowerCase()))
  let defaults = ''
  for (const ext of imageExts) {
    const e = normalizeImageExt(ext)
    if (!e || existing.has(e)) continue
    existing.add(e)
    defaults += `<Default Extension="${e}" ContentType="${imageContentType(e)}"/>`
  }
  const existingOverrides = new Set(findAll(out, 'Override').map((t) => attr(t, 'PartName') || ''))
  let ov = ''
  for (const o of overrides) {
    const m = o.match(/PartName="([^"]+)"/)
    if (m && existingOverrides.has(m[1])) continue
    ov += o
  }
  return insertBeforeClosing(out, '</Types>', defaults + ov)
}

function imageContentType(ext: string): string {
  switch (normalizeImageExt(ext)) {
    case 'jpg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'bmp':
      return 'image/bmp'
    case 'webp':
      return 'image/webp'
    case 'tiff':
      return 'image/tiff'
    case 'svg':
      return 'image/svg+xml'
    case 'emf':
      return 'image/x-emf'
    case 'wmf':
      return 'image/x-wmf'
    default:
      return 'image/png'
  }
}

/* ------------------------- 生成 drawing（浮动图） ------------------------- */

type DrawItem = { rid: string; col: number; row: number; cxPx: number; cyPx: number }

function buildDrawingXml(items: DrawItem[]): string {
  const body = items
    .map((it, i) => {
      const cx = Math.max(1, Math.round(it.cxPx * EMU_PER_PX))
      const cy = Math.max(1, Math.round(it.cyPx * EMU_PER_PX))
      return (
        `<xdr:oneCellAnchor>` +
        `<xdr:from><xdr:col>${it.col}</xdr:col><xdr:colOff>19050</xdr:colOff>` +
        `<xdr:row>${it.row}</xdr:row><xdr:rowOff>19050</xdr:rowOff></xdr:from>` +
        `<xdr:ext cx="${cx}" cy="${cy}"/>` +
        `<xdr:pic>` +
        `<xdr:nvPicPr>` +
        `<xdr:cNvPr id="${i + 2}" name="Picture ${i + 1}"/>` +
        `<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>` +
        `</xdr:nvPicPr>` +
        `<xdr:blipFill><a:blip r:embed="${it.rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
        `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
        `</xdr:pic>` +
        `<xdr:clientData/>` +
        `</xdr:oneCellAnchor>`
      )
    })
    .join('')

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    body +
    `</xdr:wsDr>`
  )
}

function buildRelsXml(items: { id: string; type: string; target: string }[]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    items
      .map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`)
      .join('') +
    `</Relationships>`
  )
}

/* --------------------- 生成 cellimages（WPS 内嵌图） --------------------- */

/**
 * WPS「嵌入单元格图片」的图片容器。
 *
 * 关键点（对齐真实 WPS 产出文件的写法）：
 * 1. 根节点命名空间用 `http://www.wps.cn/officeDocument/2017/etCustomData`，
 *    并同时声明 xdr / a / r —— 真实 WPS 文件就是这个 URI。
 * 2. 每张图一个 `<etc:cellImage>`，里面是标准 `<xdr:pic>`。
 * 3. `xdr:cNvPr/@name` 必须等于单元格公式里 DISPIMG 的 ID，WPS 靠它做关联。
 * 4. `xdr:spPr` 里的 `a:xfrm` 要给**非零**的 cx / cy，全 0 会让部分 WPS 版本
 *    认为图片尺寸非法而拒绝渲染。这里按图片真实像素换算 EMU。
 */
function buildCellImagesXml(
  entries: { id: string; rid: string; name: string; cxPx: number; cyPx: number }[],
): string {
  const body = entries
    .map((e, i) => {
      const cx = Math.max(1, Math.round(e.cxPx * EMU_PER_PX))
      const cy = Math.max(1, Math.round(e.cyPx * EMU_PER_PX))
      return (
        `<etc:cellImage><xdr:pic>` +
        `<xdr:nvPicPr>` +
        `<xdr:cNvPr id="${i + 2}" name="${e.id}" descr="${e.name}"/>` +
        `<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>` +
        `</xdr:nvPicPr>` +
        `<xdr:blipFill><a:blip r:embed="${e.rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
        `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
        `</xdr:pic></etc:cellImage>`
      )
    })
    .join('')
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<etc:cellImages xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:etc="http://www.wps.cn/officeDocument/2017/etCustomData">` +
    body +
    `</etc:cellImages>`
  )
}

/* ------------------------------ 主入口 ------------------------------ */

export async function buildXlsxBytes(sheets: OutSheet[], opts: WriteOptions): Promise<Uint8Array> {
  if (!sheets.length) throw new Error('没有可导出的数据表')

  const imageMode = opts.imageMode
  const fallbackPx = opts.fallbackImagePx ?? 160
  /** undefined = 原图原尺寸 */
  const forcedPx = opts.imageSizePx && opts.imageSizePx > 0 ? opts.imageSizePx : undefined

  /** 按选项算出图片渲染尺寸（px），保持宽高比 */
  const renderSizeOf = (img: OutImage): { w: number; h: number } => {
    const nat = probeImageSize(img)
    const nw = nat?.width ?? fallbackPx
    const nh = nat?.height ?? fallbackPx
    if (!forcedPx) return { w: nw, h: nh }
    // 等比缩放到「长边 == forcedPx」
    const scale = forcedPx / Math.max(nw, nh)
    return { w: Math.max(1, Math.round(nw * scale)), h: Math.max(1, Math.round(nh * scale)) }
  }

  const wb = XLSX.utils.book_new()
  const usedNames = new Set<string>()
  const sheetRealNames: string[] = []

  // 每个 sheet 收集：media 引用 + 图片落点
  type SheetPlan = {
    realName: string
    mediaRefs: { rid: string; img: OutImage }[]
    cells: { row: number; col: number; rid: string; img: OutImage; w: number; h: number; dispId?: string }[]
  }
  const plans: SheetPlan[] = []

  sheets.forEach((s, si) => {
    const realName = safeSheetName(s.name, usedNames)
    sheetRealNames[si] = realName

    const aoa: (string | number | boolean | null)[][] = [s.headers.slice(), ...s.rows.map((r) => r.slice())]
    // aoa_to_sheet 会以 [] 作为原点；用 origin 'A1' 保证行列与我们传的 0-based 完全一致
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: false })

    const plan: SheetPlan = { realName, mediaRefs: [], cells: [] }

    // 图片落点：给每个 sheet 内部编号 rId
    const imgRows = new Map<number, number>() // row -> 该行最大图片高度
    const imgCols = new Map<number, number>() // col -> 该列最大图片宽度
    for (const ci of s.images) {
      const rid = `rIdImg${plan.mediaRefs.length + 1}`
      const { w, h } = renderSizeOf(ci.img)
      plan.mediaRefs.push({ rid, img: ci.img })
      plan.cells.push({ row: ci.row, col: ci.col, rid, img: ci.img, w, h })
      imgRows.set(ci.row, Math.max(imgRows.get(ci.row) ?? 0, h))
      imgCols.set(ci.col, Math.max(imgCols.get(ci.col) ?? 0, w))
      expandRef(ws, ci.row, ci.col)
    }

    if (imageMode === 'dispimg') {
      for (const cell of plan.cells) {
        const addr = XLSX.utils.encode_cell({ r: cell.row, c: cell.col })
        const id = makeDispImgId()
        cell.dispId = id
        // 与真实 WPS 产出保持一致：
        //   <c r="E2" t="str"><f>_xlfn.DISPIMG("ID_xxx",1)</f><v>=DISPIMG("ID_xxx",1)</v></c>
        // 1) 公式必须带 _xlfn. 前缀，否则 WPS 认不出这是自己的扩展函数；
        // 2) <v> 必须是「公式文本」而不是空串 —— 空缓存值会让 WPS 直接显示空字符串，
        //    表现就是单元格里只剩 @image#1:xxx.png 之类的文本、图片不渲染。
        const formula = `DISPIMG("${id}",1)`
        ;(ws[addr] as unknown as Record<string, unknown>) = {
          t: 'str',
          f: `_xlfn.${formula}`,
          v: `=${formula}`,
        }
      }
    } else {
      // float 模式：单元格留空，避免图片压住文字
      for (const cell of plan.cells) {
        const addr = XLSX.utils.encode_cell({ r: cell.row, c: cell.col })
        ;(ws[addr] as unknown as Record<string, unknown>) = { t: 's', v: '' }
      }
    }

    // 行高 / 列宽：按图片实际渲染尺寸换算，让图片看起来就是「在单元格里」
    const headerRow = 0
    const rowCount = aoa.length
    const colCount = Math.max(...aoa.map((r) => r.length), s.headers.length)
    const rowsMeta: XLSX.RowInfo[] = []
    for (let r = 0; r < rowCount; r++) {
      // 1px ≈ 0.75pt；留 6pt 余量，避免图片贴边裁切
      const need = imgRows.get(r)
      if (need) rowsMeta.push({ hpt: Math.min(ROW_H_PT_MAX, Math.round(need * 0.75) + 6) })
      else rowsMeta.push(r === headerRow ? { hpt: 24 } : {})
    }
    ws['!rows'] = rowsMeta

    const colsMeta: XLSX.ColInfo[] = []
    for (let c = 0; c < colCount; c++) {
      const header = s.headers[c] ?? ''
      const base = Math.min(32, Math.max(10, Math.ceil(String(header).length * 2) + 4))
      const needW = imgCols.get(c)
      // 列宽以「0 号字体字符数」计，1 字符 ≈ 7px
      colsMeta.push({ wch: needW ? Math.min(COL_W_MAX, Math.max(base, Math.round(needW / 7) + 1)) : base })
    }
    ws['!cols'] = colsMeta

    XLSX.utils.book_append_sheet(wb, ws, realName)
    plans.push(plan)
  })

  const raw = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true }) as ArrayBuffer

  const zip = await JSZip.loadAsync(new Uint8Array(raw))

  // 1) 写入媒体文件
  const allImages: { img: OutImage }[] = []
  for (const p of plans) for (const m of p.mediaRefs) allImages.push({ img: m.img })

  const mediaPathOf = new Map<OutImage, string>()
  allImages.forEach(({ img }, i) => {
    const ext = normalizeImageExt(img.ext)
    const path = `xl/media/image${i + 1}.${ext}`
    mediaPathOf.set(img, path)
    zip.file(path, img.bytes)
  })

  const imageExts = allImages.map((x) => x.img.ext)

  // 2) 定位每个 sheet 对应的 xml 文件
  const wbXml = (await readZipString(zip, 'xl/workbook.xml')) ?? ''
  const wbRelsXml = (await readZipString(zip, 'xl/_rels/workbook.xml.rels')) ?? ''
  const wbRels = parseRelationships(wbRelsXml)
  const ridToTarget = new Map(wbRels.map((r) => [r.id, r.target]))
  const nameToSheetPath = new Map<string, string>()
  for (const tag of findAll(wbXml, 'sheet')) {
    const nm = attr(tag, 'name')
    const rid = attr(tag, 'r:id')
    if (!nm || !rid) continue
    const t = ridToTarget.get(rid)
    if (t) nameToSheetPath.set(nm, resolveZipPath('xl', t))
  }

  const contentOverrides: string[] = []

  if (imageMode === 'float') {
    for (let si = 0; si < plans.length; si++) {
      const plan = plans[si]
      if (!plan.cells.length) continue
      const sheetPath = nameToSheetPath.get(plan.realName) ?? `xl/worksheets/sheet${si + 1}.xml`
      const drawingIndex = si + 1
      const drawingPath = `xl/drawings/drawing${drawingIndex}.xml`
      const drawingRelPath = `xl/drawings/_rels/drawing${drawingIndex}.xml.rels`

      // drawing 位于 xl/drawings/，媒体位于 xl/media/，所以目标路径是 ../media/xxx
      const relItems = plan.cells.map((c) => ({
        id: c.rid,
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
        target: `../${mediaPathOf.get(c.img)!.replace(/^xl\//, '')}`,
      }))
      const drawingItems = plan.cells.map((c) => ({ rid: c.rid, col: c.col, row: c.row, cxPx: c.w, cyPx: c.h }))

      zip.file(drawingPath, buildDrawingXml(drawingItems))
      zip.file(drawingRelPath, buildRelsXml(relItems))
      contentOverrides.push(
        `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
      )

      // sheet -> drawing 关系
      const sheetRelPath = resolveZipPath(dirname(sheetPath), `_rels/${basename(sheetPath)}.rels`)
      const existingRels = zip.file(sheetRelPath)
      let sheetRelsXml: string
      let drawingRid = 'rId1'
      if (existingRels) {
        sheetRelsXml = await existingRels.async('string')
        const used = new Set(parseRelationships(sheetRelsXml).map((r) => r.id))
        let n = 1
        while (used.has(`rId${n}`)) n++
        drawingRid = `rId${n}`
      } else {
        sheetRelsXml =
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
      }
      const patchedRels = insertBeforeClosing(
        sheetRelsXml,
        '</Relationships>',
        `<Relationship Id="${drawingRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingIndex}.xml"/>`,
      )
      zip.file(sheetRelPath, patchedRels)

      // sheet xml 里挂 drawing（必须在 zip.generateAsync 之前完成，否则写入会丢失）
      const sheetXmlRaw = zip.file(sheetPath)
      if (sheetXmlRaw) {
        const sheetXml = await sheetXmlRaw.async('string')
        zip.file(sheetPath, attachDrawingToSheet(sheetXml, drawingRid))
      }
    }
  } else {
    // DISPIMG：把图片挂到 cellimages.xml
    // 注意 rels 的 Target 是相对 xl/ 目录的，必须是 media/imageN.png（不带 xl/ 前缀）
    const entries: { id: string; rid: string; name: string; cxPx: number; cyPx: number }[] = []
    const ciRels: { id: string; type: string; target: string }[] = []
    let n = 0
    for (const plan of plans) {
      for (const cell of plan.cells) {
        const dispId = cell.dispId
        if (!dispId) continue
        n++
        const rid = `rId${n}`
        const mediaPath = mediaPathOf.get(cell.img)!
        entries.push({ id: dispId, rid, name: cell.img.name, cxPx: cell.w, cyPx: cell.h })
        ciRels.push({
          id: rid,
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
          target: mediaPath.replace(/^xl\//, ''),
        })
      }
    }
    if (entries.length) {
      zip.file('xl/cellimages.xml', buildCellImagesXml(entries))
      zip.file('xl/_rels/cellimages.xml.rels', buildRelsXml(ciRels))
      contentOverrides.push(
        `<Override PartName="/xl/cellimages.xml" ContentType="application/vnd.wps-officedocument.cellimage+xml"/>`,
      )
      // workbook 关系表登记 cellimages 部件（WPS 靠这个关系类型识别）
      const used = new Set(wbRels.map((r) => r.id))
      let ridN = 1
      while (used.has(`rIdCellImages${ridN}`)) ridN++
      const patched = insertBeforeClosing(
        wbRelsXml,
        '</Relationships>',
        `<Relationship Id="rIdCellImages${ridN}" Type="http://www.wps.cn/officeDocument/2020/cellImage" Target="cellimages.xml"/>`,
      )
      zip.file('xl/_rels/workbook.xml.rels', patched)
    }
  }

  // 3) Content Types
  const ctPath = '[Content_Types].xml'
  const ctXml = await readZipString(zip, ctPath)
  if (ctXml) {
    zip.file(ctPath, patchContentTypes(ctXml, imageExts, contentOverrides))
  }

  // 4) 强制打开时重算公式，DISPIMG 才会立刻渲染出图片
  const wbEntry = zip.file('xl/workbook.xml')
  if (wbEntry) {
    const xml = await wbEntry.async('string')
    if (!/<calcPr\b/.test(xml)) {
      zip.file('xl/workbook.xml', insertBeforeClosing(xml, '</workbook>', '<calcPr calcId="0" fullCalcOnLoad="1"/>'))
    }
  }

  // 5) 按 OOXML 规范顺序重新打包
  //    SheetJS 会把「后写入的部件」（cellimages.xml、media/…）丢到压缩包末尾。
  //    实测 WPS 对这种乱序包会忽略 cellimages 部件（表现为 DISPIMG 只显示文本、
  //    图片不渲染），而按目录树顺序 + 显式目录条目重排后即正常。
  return await repackCanonical(zip)
}

/* --------------------------- ZIP 规范化重打包 --------------------------- */

/** 目录条目应当出现的先后顺序（未列出的按字母序插在 xl/ 组内） */
const DIR_ORDER = ['_rels/', 'docProps/', 'xl/', 'xl/_rels/', 'xl/theme/', 'xl/worksheets/', 'xl/media/']

function canonicalRank(path: string): number {
  // 1. 内容类型描述符永远第一
  if (path === '[Content_Types].xml') return 0

  // 2. 目录条目：按其在本表里的位置排在「直属子文件」之前
  if (path.endsWith('/')) {
    const i = DIR_ORDER.indexOf(path)
    if (i >= 0) return 100 + i * 10
    return 999
  }

  // 3. 文件：先按所属顶层目录分组，再按目录深度/名称排序
  if (path.startsWith('_rels/')) return 110
  if (path.startsWith('docProps/')) return 120
  if (path === 'xl/workbook.xml') return 200
  if (path === 'xl/_rels/workbook.xml.rels') return 201
  if (path === 'xl/styles.xml') return 210
  if (path === 'xl/theme/') return 220
  if (path.startsWith('xl/theme/')) return 221
  if (path === 'xl/sharedStrings.xml') return 230
  if (path === 'xl/metadata.xml') return 240
  if (path.startsWith('xl/worksheets/') && path.endsWith('.rels')) return 250
  if (path.startsWith('xl/worksheets/')) return 251
  if (path === 'xl/cellimages.xml') return 260
  if (path === 'xl/_rels/cellimages.xml.rels') return 261
  if (path.startsWith('xl/drawings/') && path.endsWith('.rels')) return 270
  if (path.startsWith('xl/drawings/')) return 271
  if (path.startsWith('xl/media/')) return 280
  if (path.startsWith('xl/')) return 290
  return 500
}

async function repackCanonical(src: JSZip): Promise<Uint8Array> {
  type Item = { path: string; data: Uint8Array | null; dir: boolean }
  const items: Item[] = []

  const all = Object.keys(src.files)
  for (const path of all) {
    const f = src.files[path]
    if (f.dir) {
      items.push({ path, data: null, dir: true })
      continue
    }
    items.push({ path, data: await f.async('uint8array'), dir: false })
  }

  // 补全缺失的目录条目，让压缩包和真实 WPS / Office 产出一样「带目录」
  const have = new Set(items.filter((i) => i.dir).map((i) => i.path))
  const needDirs = new Set<string>()
  for (const it of items) {
    const segs = it.path.split('/')
    segs.pop()
    let cur = ''
    for (const s of segs) {
      cur += s + '/'
      if (!have.has(cur)) needDirs.add(cur)
    }
  }
  for (const d of needDirs) items.push({ path: d, data: null, dir: true })

  items.sort((a, b) => {
    const ra = canonicalRank(a.path)
    const rb = canonicalRank(b.path)
    if (ra !== rb) return ra - rb
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  })

  const out = new JSZip()
  // 目录条目用 STORE，文件用 DEFLATE，与主流 Office 产出一致
  for (const it of items) {
    if (it.dir) {
      out.folder(it.path)
    } else {
      out.file(it.path, it.data as Uint8Array, { compression: 'DEFLATE', compressionOptions: { level: 6 } })
    }
  }
  return await out.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'DOS',
  })
}

function attachDrawingToSheet(sheetXml: string, rid: string): string {
  let xml = sheetXml
  // 确保 worksheet 上声明了 r 命名空间
  const openTagMatch = xml.match(/<worksheet\b[^>]*>/)
  if (openTagMatch && !/xmlns:r=/.test(openTagMatch[0])) {
    xml = xml.replace(openTagMatch[0], openTagMatch[0].replace(/>$/, ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'))
  }
  if (/<drawing\b/.test(xml)) {
    return xml.replace(/<drawing\b[^>]*\/>/, `<drawing r:id="${rid}"/>`)
  }
  return insertBeforeClosing(xml, '</worksheet>', `<drawing r:id="${rid}"/>`)
}

export async function buildXlsxBlob(sheets: OutSheet[], opts: WriteOptions): Promise<Blob> {
  const bytes = await buildXlsxBytes(sheets, opts)
  return new Blob([bytes as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export { escapeRegExp }
