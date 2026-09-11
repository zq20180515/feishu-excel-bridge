/**
 * 真实组件渲染校验（UI 重设计）。
 *
 * 与 `render.ts` 的区别：那边用「复刻结构」的方式测设计意图，
 * 这边通过 stub 掉飞书 SDK，**直接渲染真实的面板组件**，
 * 因此能覆盖 hero 空态、步骤条、环形进度、完成态这些实际 JSX。
 *
 * 运行：npm run test:ui
 *
 * 用 linkedom 而不是 jsdom：jsdom 内部有动态 require + 依赖链里的
 * http-proxy-agent 在 Windows 下 main 字段解析会炸。
 */
import { parseHTML } from 'linkedom'

const dom = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
const win = dom.window as unknown as Record<string, unknown> & {
  document: Document
  location?: { protocol: string; href: string }
}

if (!win.location) {
  win.location = { protocol: 'http:', href: 'http://localhost/' }
}

const g = globalThis as unknown as Record<string, unknown>
function setGlobal(key: string, value: unknown) {
  try {
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: false,
    })
  } catch {
    g[key] = value
  }
}

setGlobal('window', win)
setGlobal('document', win.document)
setGlobal('navigator', win.navigator ?? { userAgent: 'node' })
setGlobal('HTMLElement', win.HTMLElement)
setGlobal('Element', win.Element)
setGlobal('Node', win.Node)
setGlobal('Event', win.Event)
setGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const document = win.document as Document

let failed = 0
function ok(cond: boolean, label: string, extra?: unknown) {
  if (cond) console.log(`  ✓ ${label}`)
  else {
    failed++
    console.log(`  ✗ ${label}`, extra === undefined ? '' : JSON.stringify(extra))
  }
}

async function main() {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { createElement, Fragment } = React
  const act = (React as unknown as { act: (fn: () => Promise<void>) => Promise<void> }).act

  const { default: App } = await import('../src/App')
  const { default: ImportPanel } = await import('../src/components/ImportPanel')
  const { default: ExportPanel } = await import('../src/components/ExportPanel')
  const { Steps, RingProgress, CompletionCard, Card } = await import('../src/components/ui')
  const { IMPORTABLE_FILE_TYPES } = await import('../src/lib/field-meta')

  const host = document.getElementById('root')!
  const root = createRoot(host)

  const noop = async () => {}

  /* ============ 1. App 外壳（顶栏 + 品牌 + 分段控件） ============ */
  await act(async () => {
    root.render(createElement(App))
  })
  await act(async () => {})

  let html = host.innerHTML
  console.log('\n=== 1. App 外壳 ===')
  ok(html.length > 1500, 'App 渲染出内容', { length: html.length })
  ok(!!host.querySelector('.brand-mark'), '品牌标 .brand-mark 存在')
  ok(!!host.querySelector('.brand-mark svg'), '品牌标里是图标（不是纯色块）')
  ok(!!host.querySelector('.brand-name'), '品牌名存在')
  ok(/BTNExcel 桥/.test(html), '品牌名为「BTNExcel 桥」')
  ok(/原样导入 \/ 带图导出/.test(html), '品牌副标题存在')
  ok(!!host.querySelector('.brand-feedback'), '反馈入口仍在插件名后（未因改版丢失）')
  ok(!!host.querySelector('.segmented.tabs'), '顶部分段控件存在')
  ok(host.querySelectorAll('.segmented.tabs .seg').length === 2, '分段控件有「导入 / 导出」两项')
  ok(!!host.querySelector('.seg.active'), '分段控件有选中态')

  /* ============ 2. 导入面板：步骤条 + hero 空态 ============ */
  await act(async () => {
    root.render(createElement(ImportPanel, { tables: [], reloadTables: noop }))
  })
  html = host.innerHTML
  console.log('\n=== 2. 导入面板（空态） ===')
  ok(!!host.querySelector('.steps'), '渲染了步骤条 .steps')
  ok(host.querySelectorAll('.step').length === 3, '步骤条共 3 步', {
    got: host.querySelectorAll('.step').length,
  })
  ok(/选文件/.test(html) && /字段映射/.test(html) && /导入/.test(html), '三步文案为 选文件/字段映射/导入')
  ok(host.querySelectorAll('.step-line').length === 2, '步骤之间有 2 条连接线')
  ok(!!host.querySelector('.step.cur'), '有当前步骤 .step.cur')
  ok(!host.querySelector('.step.done'), '空态下没有已完成的步骤')

  ok(!!host.querySelector('.hero'), '未选文件时渲染 hero 空态 .hero')
  ok(!!host.querySelector('.hero-art'), 'hero 有图标区 .hero-art')
  ok(!!host.querySelector('.hero-art svg'), 'hero 图标是 SVG（矢量，不依赖图片资源）')
  ok(/把 Excel 搬进多维表格/.test(html), 'hero 主标题文案存在')
  ok(!!host.querySelector('.hero h2'), 'hero 主标题用 <h2>')
  ok(!!host.querySelector('.hero p'), 'hero 副标题存在')

  ok(!!host.querySelector('.card-pad'), 'flush 卡片用 .card-pad 提供内边距')
  const dz = host.querySelector('.dropzone') as HTMLElement | null
  ok(!!dz, '拖放区存在')
  ok(!!dz && !dz.className.includes('compact'), '未选文件时拖放区是展开态（非 compact）')
  ok(!!host.querySelector('.dz-icon'), '拖放区有圆形图标底 .dz-icon')
  ok(/拖入表格文件，或点击选择/.test(html), '拖放区主文案存在')
  const ftypes = host.querySelectorAll('.ftype').length
  ok(ftypes === IMPORTABLE_FILE_TYPES.length, '文件类型徽章渲染完整', {
    got: ftypes,
    want: IMPORTABLE_FILE_TYPES.length,
  })
  ok(!host.querySelector('.success-wrap'), '空态下不渲染完成页')
  ok(!host.querySelector('.footer-bar'), '空态下不渲染底部操作栏')
  ok(!!host.querySelector('.ftype-info'), '格式说明收进 .ftype-info（? 图标）')
  ok(!/常用格式都能直接拖入/.test(html), '不再渲染整段格式说明的提示条（改成悬停查看）')
  ok(!!host.querySelector('.hero'), 'hero 与格式徽章可以共存（hero 在上）')

  /* ============ 3. 导出面板：选项行 + 底部栏 ============ */
  await act(async () => {
    root.render(createElement(ExportPanel, { tables: [], reloadTables: noop }))
  })
  html = host.innerHTML
  console.log('\n=== 3. 导出面板 ===')
  ok(/选择要导出的数据表/.test(html), '渲染「选择要导出的数据表」卡片')
  ok(!!host.querySelector('.empty'), '无数据表时显示空态 .empty')
  ok(/导出选项/.test(html), '渲染「导出选项」卡片')
  const optRows = host.querySelectorAll('.opt-row').length
  ok(optRows >= 3, `导出选项为行式布局（${optRows} 个 .opt-row）`, { optRows })
  ok(/WPS嵌入单元格图片/.test(html), '嵌图方式：WPS 嵌入单元格图片')
  ok(/标准浮动图片/.test(html), '嵌图方式：标准浮动图片')
  ok(/图片边长/.test(html), '含「图片边长」选项')
  ok(/全部图片都导出/.test(html), '含「全部图片都导出」选项')
  ok(!!host.querySelector('.footer-bar'), '底部固定操作栏存在')
  ok(!!host.querySelector('.footer-bar .btn.primary'), '底部栏有主按钮（近黑实底）')
  ok(!!host.querySelector('.segmented'), '嵌图方式用分段控件')
  ok(!host.querySelector('.success-wrap'), '未导出时不渲染完成页')
  ok(!/把附件里的图片嵌入单元格/.test(html), '「把附件里的图片嵌入单元格」开关已移除（与嵌图方式重复）')
  ok(/合并为一个 Excel/.test(html), '新增「合并为一个 Excel」选项')
  ok(/拆分多个 Excel/.test(html), '新增「拆分多个 Excel」选项')
  const optGroups = host.querySelectorAll('.opt-group').length
  ok(optGroups === 2, '导出选项分「导出方式 / 图片嵌入方式」两组', { optGroups })
  ok(!host.querySelector('.opt-group.disabled'), '选项组不再有整体禁用态（嵌图开关已移除）')

  /* ============ 4. 步骤条（各阶段） ============ */
  console.log('\n=== 4. 步骤条各阶段 ===')
  await act(async () => {
    root.render(
      createElement(
        'div',
        null,
        createElement('div', { id: 's0' }, createElement(Steps, { items: ['选文件', '字段映射', '导入'], current: 0 })),
        createElement('div', { id: 's1' }, createElement(Steps, { items: ['选文件', '字段映射', '导入'], current: 1 })),
        createElement('div', { id: 's2' }, createElement(Steps, { items: ['选文件', '字段映射', '导入'], current: 2 })),
      ),
    )
  })
  const s0 = document.getElementById('s0')!
  const s1 = document.getElementById('s1')!
  const s2 = document.getElementById('s2')!
  ok(s0.querySelectorAll('.step.done').length === 0 && !!s0.querySelector('.step.cur'), '阶段 0：第 1 步为当前步')
  ok(s1.querySelectorAll('.step.done').length === 1 && !!s1.querySelector('.step.cur'), '阶段 1：第 1 步已完成')
  ok(s2.querySelectorAll('.step.done').length === 2 && !!s2.querySelector('.step.cur'), '阶段 2：第 3 步为当前步')
  ok(!!s1.querySelector('.step.done .dot svg'), '已完成的步骤圆点里是对勾图标')

  // current = items.length 表示三步全部完成（导入结束后的状态）
  await act(async () => {
    root.render(createElement('div', { id: 's3' }, createElement(Steps, { items: ['选文件', '字段映射', '导入'], current: 3 })))
  })
  const s3 = document.getElementById('s3')!
  ok(s3.querySelectorAll('.step.done').length === 3, '全完成后三步都标 done', {
    got: s3.querySelectorAll('.step.done').length,
  })
  ok(!s3.querySelector('.step.cur'), '全完成后不再有 cur 高亮')

  /* ============ 5. 环形进度 ============ */
  console.log('\n=== 5. 环形进度 ===')
  await act(async () => {
    root.render(
      createElement(
        'div',
        null,
        createElement('div', { id: 'r1' },
          createElement(RingProgress, { done: 3, total: 4, label: '正在写入记录', detail: '第 62 / 91 行' })),
        createElement('div', { id: 'r2' },
          createElement(RingProgress, { done: 0, total: 0, indeterminate: true, tone: 'export', label: '打包工作簿' })),
      ),
    )
  })
  const r1 = document.getElementById('r1')!
  const r2 = document.getElementById('r2')!
  ok(!!r1.querySelector('.progress-card'), '环形进度外层 .progress-card')
  ok(!!r1.querySelector('.ring-wrap'), '有环形容器 .ring-wrap')
  ok(r1.querySelectorAll('.ring-wrap svg circle').length === 2, '环形由底环 + 进度环两段组成')
  ok(!!r1.querySelector('.ring-bg') && !!r1.querySelector('.ring-fg'), '底环 .ring-bg / 进度环 .ring-fg 就位')
  ok(/75/.test(r1.textContent ?? ''), '按 3/4 算出 75%', { text: (r1.textContent ?? '').trim().slice(0, 40) })
  ok(!!r1.querySelector('.ring-unit'), '百分比带 % 单位元素')
  ok(/正在写入记录/.test(r1.textContent ?? ''), '显示当前阶段文案')
  ok(/第 62 \/ 91 行/.test(r1.textContent ?? ''), '显示阶段明细')
  const r1bar = r1.querySelector('.ring-wrap') as unknown as { getAttribute?: (n: string) => string | null }
  ok(r1bar?.getAttribute?.('aria-valuenow') === '75', '无障碍暴露 aria-valuenow=75')
  ok(!r1.querySelector('.progress-card')?.className.includes('spinning'), '已知总量时不走不确定态')

  ok(r2.querySelector('.progress-card')?.className.includes('spinning'), '不确定总量时加 .spinning')
  ok(/—/.test(r2.textContent ?? ''), '不确定态百分比显示为 —（而不是假的 0%）')
  ok(/打包工作簿/.test(r2.textContent ?? ''), '不确定态仍显示阶段文案')
  const r2bar = r2.querySelector('.ring-wrap') as unknown as { getAttribute?: (n: string) => string | null }
  ok(r2bar?.getAttribute?.('aria-valuenow') === null, '不确定态不暴露 aria-valuenow')

  /* ---- 阶段清单（传 stages + currentStage） ---- */
  await act(async () => {
    root.render(
      createElement('div', { id: 'r3' },
        createElement(RingProgress, {
          done: 62,
          total: 91,
          label: '正在写入记录',
          detail: '员工档案 · 第 62 / 91 行',
          stages: [
            { key: 'parse', label: '解析工作表与表头' },
            { key: 'media', label: '上传附件图片' },
            { key: 'fields', label: '创建数据表与字段' },
            { key: 'records', label: '写入记录' },
          ],
          currentStage: 'media',
        })),
    )
  })
  const r3 = document.getElementById('r3')!
  ok(!!r3.querySelector('.stage-list'), '传 stages 时渲染阶段清单 .stage-list')
  ok(r3.querySelectorAll('.stage').length === 4, '阶段清单共 4 项', {
    got: r3.querySelectorAll('.stage').length,
  })
  ok(r3.querySelectorAll('.stage.done').length === 1, '当前阶段之前的项标 done', {
    got: r3.querySelectorAll('.stage.done').length,
  })
  ok(!!r3.querySelector('.stage.active'), '当前阶段标 active')
  ok(!!r3.querySelector('.stage.active .spin'), '进行中的阶段显示转圈图标')
  ok(r3.querySelectorAll('.stage .hollow').length === 2, '未开始的阶段显示空心圈', {
    got: r3.querySelectorAll('.stage .hollow').length,
  })
  ok(r3.querySelector('.stage.done .sic svg') !== null, '已完成的阶段显示对勾图标')
  ok(/62 \/ 91/.test(r3.textContent ?? ''), '进行中的阶段带上进度（62 / 91）')
  ok(/62 \/ 91/.test(r3.textContent ?? ''), '进行中的阶段带上进度（62 / 91）')

  // 不传 stages 时不应出现空清单
  await act(async () => {
    root.render(createElement('div', { id: 'r4' }, createElement(RingProgress, { done: 1, total: 2 })))
  })
  ok(!document.getElementById('r4')!.querySelector('.stage-list'), '不传 stages 时不渲染清单')

  /* ============ 6. 完成态卡片 ============ */
  console.log('\n=== 6. 完成态卡片 ===')
  await act(async () => {
    root.render(
      createElement(Card, null,
        createElement(CompletionCard, {
          title: '导入完成',
          subtitle: '1 张数据表已写入当前多维表格',
          stats: [
            { v: 1, k: '数据表' },
            { v: 6, k: '字段' },
            { v: 91, k: '行记录' },
            { v: 0, k: '附件图片' },
          ],
          actions: createElement('button', { className: 'btn primary' }, '再导入一个'),
          note: '同名数据表已自动加序号',
        },
          createElement('div', { className: 'result-list' },
            createElement('div', { className: 'result-item' }, '员工档案'))),
      ),
    )
  })
  html = host.innerHTML
  ok(!!host.querySelector('.success-wrap'), '完成态有 .success-wrap')
  ok(!!host.querySelector('.success-ring'), '大对勾容器 .success-ring')
  ok(!!host.querySelector('.success-ring svg'), '对勾用 SVG 图标')
  ok(/导入完成/.test(html), '完成态标题「导入完成」')
  ok(!!host.querySelector('.stat-grid'), '统计网格 .stat-grid')
  ok(host.querySelectorAll('.stat').length === 4, '统计网格 4 格', {
    got: host.querySelectorAll('.stat').length,
  })
  ok(!!host.querySelector('.stat .v') && !!host.querySelector('.stat .k'), '每格有数值 .v 与说明 .k')
  ok(!!host.querySelector('.done-actions'), '底部动作区 .done-actions')
  ok(!!host.querySelector('.note-line'), '底部补充说明 .note-line')
  ok(!!host.querySelector('.result-list'), '明细列表作为 children 渲染在动作区之前')

  /* ============ 7. 回归护栏：老结构不能丢 ============ */
  console.log('\n=== 7. 回归护栏 ===')
  await act(async () => {
    root.render(createElement(ImportPanel, { tables: [], reloadTables: noop }))
  })
  html = host.innerHTML
  ok(!host.querySelector('table'), '没有 <table> 布局（侧栏不产生横向滚动）')
  ok(!!host.querySelector('.dropzone'), '拖放区仍在（导入入口未变）')
  ok(!!host.querySelector('.ftype'), '文件类型徽章仍在')
  ok(/<input[^>]+type="file"/.test(html), '隐藏的 file input 仍在（点击拖放区触发）')
  ok(/表头在第/.test(html), '「表头在第 N 行」选项仍在')
  ok(/重新解析/.test(html), '「重新解析」按钮仍在')
  ok(/导入选项/.test(html), '「导入选项」折叠入口仍在')
  ok(/xlsx/.test(html) && /csv/.test(html), '仍提示支持 xlsx / csv')

  /* ============ 8. 字段映射：字段名限长展示 ============ */
  console.log('\n=== 8. 字段映射 ===')
  const { default: MappingEditor } = await import('../src/components/MappingEditor')

  const col = (i: number, header: string, enabled: boolean) => ({
    key: `s::${i}`,
    sheet: '员工档案',
    col: i,
    letter: String.fromCharCode(65 + i),
    header,
    samples: [],
    valueCount: 3,
    mediaCount: 0,
    inferredType: 1,
    enabled,
    targetFieldId: '',
    targetFieldName: header,
    targetFieldType: 1,
    typeTouched: false,
  })

  const sheetFixture = {
    name: '员工档案',
    matrix: [],
    headerRowIndex: 0,
    totalDataRows: 3,
    mediaByCell: new Map(),
    importTableName: '员工档案',
    importMode: 'create' as const,
    importTableId: '',
    columns: [
      col(0, '工号', true),
      col(1, '云南贝泰妮生物科技集团股份有限公司采购部名称全称', true),
      col(2, '是否转正', false),
    ],
  }

  await act(async () => {
    root.render(
      createElement(
        'div',
        null,
        createElement(Card, { title: '字段映射' },
          createElement(MappingEditor, {
            sheets: [sheetFixture],
            tables: [{ id: 'tbl1', name: '员工档案' }],
            onChange: () => {},
            onLoadFields: async () => [],
          })),
      ),
    )
  })
  html = host.innerHTML
  ok(host.querySelectorAll('.fld-name').length === 3, '每个字段名用 .fld-name 渲染', {
    got: host.querySelectorAll('.fld-name').length,
  })
  ok(!host.querySelector('.map-name input'), '未进入编辑态时字段名不是 input（超长文本不会撑破排版）')
  ok(!!host.querySelector('.fld-name-inner'), '字段名有 .fld-name-inner 承载文本（溢出时才滚动）')
  ok(/云南贝泰妮生物科技集团股份有限公司采购部名称全称/.test(html), '超长字段名完整保留在 DOM 里（不截断数据）')
  ok(!!host.querySelector('.map-row.off'), '取消勾选的字段行带 .off（灰化 + 删除线）')
  ok(!!host.querySelector('.map-arrow'), '映射行仍保留 → 指示符')
  ok(!!host.querySelector('.tk-btn'), '字段类型仍是可点击胶囊 .tk-btn')
  ok(!/每个工作表单独成表/.test(html), '已移除「每个工作表单独成表…」的说明文案')

  /* ============ 9. 附件上传：超时保护与逐个兜底 ============ */
  console.log('\n=== 9. 附件上传的容错 ===')
  const { uploadFilesSerial } = await import('../src/lib/base-api')
  const { stubState, resetUploadStub } = await import('./stub-sdk')

  const mkFiles = (n: number) =>
    Array.from(
      { length: n },
      (_x, i) => new File([new Uint8Array([i])], `p${i}.jpg`, { type: 'image/jpeg' }),
    )

  // ① 正常路径：整批一次调用就够
  resetUploadStub()
  let upOut = await uploadFilesSerial(mkFiles(4), 4)
  ok(upOut.failures.length === 0, '正常情况无失败项')
  ok(upOut.tokens.length === 4 && upOut.tokens.every(Boolean), '每个文件都拿到 token')
  ok(stubState.calls.length === 1, '整批一次调用完成', { calls: stubState.calls })
  ok(upOut.timings.length === 4, '返回每个文件的耗时明细', { n: upOut.timings.length })
  ok(upOut.timings.every((t) => t.ok && t.ms >= 0), '正常上传的明细标记为成功')

  // ② 批量返回不全 → 必须逐个兜底（修复前这里是个空循环，会静默丢文件）
  resetUploadStub()
  stubState.mode = 'partial'
  upOut = await uploadFilesSerial(mkFiles(3), 3)
  ok(stubState.calls.length === 4, '批量拿不到 token 时会逐个补传', { calls: stubState.calls })
  ok(upOut.failures.length === 3, '逐个也失败时全部记为失败（不再静默丢弃）', {
    n: upOut.failures.length,
  })
  ok(
    /未返回 token/.test(upOut.failures[0]?.message ?? ''),
    '失败原因可读',
    { msg: upOut.failures[0]?.message },
  )

  // ③ 接口挂起 → 必须被超时兜住，绝不能永久等待（真机上 439 个附件卡在第 210 个就是栽在这）
  resetUploadStub()
  stubState.mode = 'hang'
  const t0 = Date.now()
  upOut = await uploadFilesSerial(mkFiles(2), 2, undefined, { timeoutMs: 80 })
  const cost = Date.now() - t0
  ok(cost < 3000, `接口挂起时靠超时退出（耗时 ${cost}ms，理论上限 160ms）`, { cost })
  ok(upOut.failures.length === 2, '挂起的附件记为失败后继续', { n: upOut.failures.length })
  ok(/超时/.test(upOut.failures[0]?.message ?? ''), '失败信息里写明是超时', {
    msg: upOut.failures[0]?.message,
  })
  ok(upOut.tokens.every((t) => t === null), '超时的文件 token 保持空（上层据此跳过该单元格）')
  ok(upOut.timings.length === 2 && upOut.timings.every((t) => !t.ok), '超时的文件也写进耗时明细并标记失败', {
    n: upOut.timings.length,
  })

  // ④ 取消：shouldStop 为真时不发起任何上传
  resetUploadStub()
  upOut = await uploadFilesSerial(mkFiles(10), 2, undefined, { shouldStop: () => true })
  ok(stubState.calls.length === 0, 'shouldStop 为真时不发起任何上传', { calls: stubState.calls.length })
  ok(upOut.tokens.every((t) => t === null), '中断时全部文件保持空 token')

  console.log(`\n${failed === 0 ? '真实组件渲染校验全部通过 ✅' : `失败 ${failed} 项 ❌`}`)
  process.exit(failed === 0 ? 0 : 1)
}

void main()
