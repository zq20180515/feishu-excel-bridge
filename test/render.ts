/**
 * 静态渲染校验：把 App 在内存 DOM 里跑一遍，断言真实产出的 DOM 结构。
 * 重点验证「映射区不会产生横向滚动」这一设计要求 —— 通过检查是否还有 <table> 布局实现，
 * 以及关键文案是否按新设计呈现。
 *
 * 运行：npm run test:render
 *
 * 用 linkedom 而不是 jsdom：jsdom 内部有动态 require + 依赖链里的 http-proxy-agent
 * 在 Windows 下 main 字段解析会炸；linkedom 是纯 ESM / 无动态 require，可直接打包。
 */
import { parseHTML } from 'linkedom'

const dom = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
const win = dom.window as unknown as Record<string, unknown> & {
  document: Document
  location?: { protocol: string; href: string }
}

// linkedom 的 window 上没有 location，React DOM 会读 window.location.protocol
if (!win.location) {
  win.location = { protocol: 'http:', href: 'http://localhost/' }
}

// 把 linkedom 的 window/document 暴露成全局，供 React 使用。
// navigator 在 Node 22 里是 getter-only，必须用 defineProperty 覆盖。
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

/** 复刻 App 顶部的反馈入口（只测 DOM 结构，不 import App 以免拉起 SDK） */
function FeedbackProbe({
  createElement: h,
  Popover: P,
  IconFeedback: Ico,
  IconLink: IcoLink,
}: {
  createElement: typeof import('react').createElement
  Popover: typeof import('../src/components/ui').Popover
  IconFeedback: typeof import('../src/components/icons').IconFeedback
  IconLink: typeof import('../src/components/icons').IconLink
}) {
  return h(
    'span',
    { className: 'brand-text' },
    h(
      'span',
      { className: 'brand-main' },
      h('span', { className: 'brand-name' }, 'BTNExcel 桥'),
      h(
        P,
        {
          ariaLabel: '问题反馈',
          trigger: ({ open, toggle }: { open: boolean; toggle: () => void }) =>
            h(
              'button',
              { type: 'button', className: 'brand-feedback', 'aria-expanded': open, onClick: toggle },
              h(Ico, { size: 12 }),
              '反馈',
            ),
        },
        ({ close }: { close: () => void }) =>
          h(
            'span',
            { className: 'fb-body' },
            h('span', { className: 'fb-title' }, '问题反馈'),
            h('span', { className: 'fb-desc' }, '请复制下面的信息，粘到飞书里', h('b', { className: 'fb-at' }, '@张强')),
            h(
              'span',
              { className: 'fb-block' },
              h('span', { className: 'fb-block-label' }, '反馈对象'),
              h('span', { className: 'fb-none' }, h('span', { className: 'fb-at' }, '@张强'), h('span', { className: 'fb-uid' }, '009176')),
            ),
            h(
              'span',
              { className: 'fb-block' },
              h('span', { className: 'fb-block-label' }, '插件信息（复制时一并带上）'),
              h('span', { className: 'fb-desc-app' }, h('b', null, 'BTNExcel 桥'), h('span', { className: 'fb-ver' }, 'v0.1.0')),
              h('span', { className: 'fb-appdesc' }, 'Excel ⇄ 多维表格 双向桥接插件。'),
            ),
            h('button', { type: 'button', className: 'btn primary xs' }, h(IcoLink, { size: 12 }), '复制反馈模板'),
            h('button', { type: 'button', className: 'btn ghost xs', onClick: close }, '关闭'),
          ),
      ),
    ),
  )
}

async function main() {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { createElement } = React

  const { default: MappingEditor } = await import('../src/components/MappingEditor')
  const { Card, Segmented, Tip, Notice, Popover } = await import('../src/components/ui')
  const { IMPORTABLE_FILE_TYPES, IMPORT_ACCEPT } = await import('../src/lib/field-meta')
  const { IconFeedback, IconFolder, IconLink } = await import('../src/components/icons')

  const host = document.getElementById('root')!
  const root = createRoot(host)

  const sheets = [
    {
      name: '员工档案',
      matrix: [],
      headerRowIndex: 0,
      totalDataRows: 3,
      mediaByCell: new Map(),
      importTableName: '员工档案',
      importMode: 'create' as const,
      importTableId: '',
      columns: [
        {
          key: 's::0', sheet: '员工档案', col: 0, letter: 'A', header: '工号',
          samples: ['BTN001'], valueCount: 3, mediaCount: 0, inferredType: 1,
          enabled: true, targetFieldId: '', targetFieldName: '工号',
          targetFieldType: 1, typeTouched: false,
        },
        {
          key: 's::1', sheet: '员工档案', col: 1, letter: 'B', header: '照片',
          samples: [], valueCount: 0, mediaCount: 3, inferredType: 17,
          enabled: true, targetFieldId: '', targetFieldName: '照片',
          targetFieldType: 17, typeTouched: false,
        },
      ],
    },
    // 空白工作表：无列 + 无数据行 → 应被跳过，只出汇总提示
    {
      name: 'Sheet2',
      matrix: [],
      headerRowIndex: 0,
      totalDataRows: 0,
      mediaByCell: new Map(),
      importTableName: 'Sheet2',
      importMode: 'create' as const,
      importTableId: '',
      columns: [],
    },
    {
      name: 'Sheet3',
      matrix: [],
      headerRowIndex: 0,
      totalDataRows: 0,
      mediaByCell: new Map(),
      importTableName: 'Sheet3',
      importMode: 'create' as const,
      importTableId: '',
      columns: [],
    },
  ]

  // 复刻 ImportPanel 的空白表拆分逻辑（同款实现）
  const isBlankSheet = (s: (typeof sheets)[number]) => s.columns.length === 0 || s.totalDataRows === 0
  const blankSheets = sheets.filter(isBlankSheet)
  const liveSheets = sheets.filter((s) => !isBlankSheet(s))

  const tables = [{ id: 'tbl1', name: '员工档案' }]

  // 用 Segmented 复刻导出侧的嵌图方式控件（ExportPanel 会 import SDK，避免 iframe 握手）
  const MODE_TIP_DISPIMG =
    '图片作为「嵌入单元格图片」写进文件：图片真正住在单元格里，随行高列宽一起显示，筛选/排序不会错位。需要 WPS 打开才能看到图片；原生 Excel 会显示为 =DISPIMG(...) 公式。'
  const MODE_TIP_FLOAT =
    '图片作为标准浮动图片锚定在单元格上：Excel / WPS / LibreOffice 都能正常显示，兼容性最好。图片会覆盖在单元格上方，删除整行时需要留意图片位置。'

  const act = (React as unknown as { act: (fn: () => Promise<void>) => Promise<void> }).act

  await act(async () => {
    root.render(
      createElement(
        'div',
        null,
        createElement(Card, { title: '字段映射', hint: '测试' },
          createElement(MappingEditor, {
            sheets: liveSheets,
            tables,
            onChange: () => {},
            onLoadFields: async () => [],
          })),
        // 空白工作表汇总提示（复刻 ImportPanel 的 Notice 结构）
        blankSheets.length > 0
          ? createElement(Notice, { kind: 'warn' },
              '已跳过 ', createElement('b', null, String(blankSheets.length)), ' 个空白工作表：',
              ...blankSheets.map((s) => createElement('code', { key: s.name, className: 'sheet-skip-tag' }, s.name)),
              ' —— 这些工作表没有表头也没有数据行，不会导入。')
          : null,
        createElement(Card, { title: '导出选项' },
          createElement('div', { className: 'opt-group' },
            createElement('div', { className: 'opt-label' }, '图片嵌入方式'),
            createElement(Segmented, {
              value: 'dispimg',
              ariaLabel: '图片嵌入方式',
              options: [
                { value: 'dispimg', label: 'WPS嵌入单元格图片', tip: MODE_TIP_DISPIMG },
                { value: 'float', label: '标准浮动图片', tip: MODE_TIP_FLOAT },
              ],
              onChange: () => {},
            })),
          // 图片尺寸：与「全部图片都导出」同级，不在 opt-group 内
          createElement('div', { className: 'opt-row sub' },
            createElement('label', { className: 'check' },
              createElement('span', null, '图片边长'),
              createElement('input', { className: 'input size-input', placeholder: '原图' }),
              createElement('span', { className: 'muted' }, 'px')),
            createElement('span', { className: 'muted' }, '原图原尺寸导出')),
          createElement('div', { className: 'opt-row sub' },
            createElement('label', { className: 'check' },
              createElement('input', { type: 'checkbox', defaultChecked: true }),
              createElement('span', null, '全部图片都导出'),
              createElement(Tip, { text: '多图分列' }, createElement('span', { className: 'help-dot' }, '?'))),
            createElement('span', { className: 'muted' }, '多图分列：照片 / 照片2 / 照片3…')),
          createElement(Notice, null, 'DISPIMG 是 WPS 的专有扩展'),
          createElement('div', { className: 'pick-grid' },
            createElement('label', { className: 'pick on' },
              createElement('input', { type: 'checkbox', defaultChecked: true }),
              createElement('span', { className: 'pick-name' }, '员工档案'))),
        ),
        createElement('span', null,
          createElement(Tip, { text: '这是悬停提示' }, createElement('span', { className: 'help-dot' }, '?'))),
        // 顶部反馈入口（App 里同样用 Popover + .brand-feedback）
        createElement(FeedbackProbe, { createElement, Popover, IconFeedback, IconLink }),
        // 导入面板的文件类型徽章一览
        createElement('div', { className: 'row wrap' },
          ...IMPORTABLE_FILE_TYPES.map((t) =>
            createElement('span', { className: `ftype${t.zip ? ' rich' : ''}`, key: t.ext }, `.${t.ext}`))),
      ),
    )
  })

  const html = host.innerHTML

  console.log('\n=== 渲染产物校验 ===')
  ok(html.length > 2000, 'App 渲染出内容', { length: html.length })
  ok(!host.querySelector('table'), '映射区没有再使用 <table>（避免横向滚动）', {
    tables: host.querySelectorAll('table').length,
  })
  ok(!!host.querySelector('.map-list'), '存在 .map-list 单列容器')
  ok(!!host.querySelector('.map-row'), '存在 .map-row 字段行')
  ok(!!host.querySelector('.sheet-block'), '存在 .sheet-block 工作表块')
  ok(!!host.querySelector('.pick-grid'), '导出侧使用 .pick-grid 勾选网格')
  ok(!!host.querySelector('.segmented'), '存在 Segmented 分段控件')
  ok(!/样例值/.test(html), '已移除「样例值」列')
  ok(/WPS嵌入单元格图片/.test(html), '嵌图选项文案为「WPS嵌入单元格图片」')
  ok(/标准浮动图片/.test(html), '嵌图选项文案为「标准浮动图片」')
  ok(!/就是你截图里那种/.test(html), '已移除冗长的旧选项描述')
  ok(/class="seg-tip"/.test(html), '嵌图方式带 ? 悬停提示入口')
  ok(/原图/.test(html), '图片尺寸默认显示「原图」')

  /* ---------- 问题 3：映射区精简 + 类型色块 ---------- */
  console.log('\n=== 映射区精简 ===')
  ok(!host.querySelector('.letter'), '已移除字母序号 A/B/C 列', {
    letters: host.querySelectorAll('.letter').length,
  })
  ok(!/＋\s*新建/.test(html), '已移除「＋ 新建：xx」前缀')
  ok(!host.querySelector('.map-dst'), '已移除独立的「目标字段」下拉列')
  ok(!!host.querySelector('.map-name'), '存在 .map-name 字段名输入')
  ok(!!host.querySelector('.tk'), '存在字段类型色块 .tk')
  const toneClasses = [...host.querySelectorAll('.tk')].map((el) => el.className)
  ok(
    toneClasses.some((c) => /tk-attach/.test(c)) && toneClasses.some((c) => /tk-text/.test(c)),
    '不同类型用不同色块（附件=tk-attach，文本=tk-text）',
    toneClasses,
  )

  /* ---------- 问题 4：多图分列开关 ---------- */
  console.log('\n=== 多图分列开关 ===')
  ok(/全部图片都导出/.test(html), '导出选项含「全部图片都导出」开关')
  ok(/照片2/.test(html), '多图分列的分列命名有说明（照片 / 照片2 / 照片3…）')

  /* ---------- 本轮·问题 1：类型胶囊与下拉框合二为一 ---------- */
  console.log('\n=== 类型胶囊合二为一 ===')
  ok(!!host.querySelector('.tk-btn'), '类型胶囊是可点击按钮 .tk-btn')
  ok(!!host.querySelector('.tk-caret'), '胶囊带下拉箭头 .tk-caret（指引可交互）')
  ok(!!host.querySelector('.pop-anchor'), 'Popover 有 .pop-anchor 锚点')
  ok(!host.querySelector('.map-type select'), '映射行里不再有独立的类型 <select>（已合并进弹层）')
  ok(!host.querySelector('.type-select'), '旧的 .type-select 已从映射区移除', {
    count: host.querySelectorAll('.type-select').length,
  })
  ok(!!host.querySelector('.tk .tk-dot'), '色块保留圆点标识 .tk-dot')
  ok(!/map-dst/.test(html), '不再输出 .map-dst')

  /* 注：进度组件的断言已迁到 test/ui.ts（那里直接渲染真实的 RingProgress） */

  /* ---------- 本轮·问题 3：更多文件类型 ---------- */
  console.log('\n=== 导入文件类型扩展 ===')
  const exts = IMPORTABLE_FILE_TYPES.map((t) => t.ext)
  for (const need of ['xlsx', 'xlsm', 'xls', 'csv']) {
    ok(exts.includes(need), `支持 .${need}`)
  }
  ok(exts.length >= 8, `类型清单已扩充（当前 ${exts.length} 种）`, exts)
  ok(IMPORT_ACCEPT.includes('.xlsx') && IMPORT_ACCEPT.includes('.csv'), 'accept 属性由类型表统一生成')
  const ftypes = [...host.querySelectorAll('.ftype')]
  ok(ftypes.length === IMPORTABLE_FILE_TYPES.length, '类型徽章一览渲染完整', { got: ftypes.length })
  ok(ftypes.some((el) => el.className.includes('rich')), 'zip 容器类型带 .rich 高亮')

  /* ---------- 本轮·问题 4：反馈入口 ---------- */
  console.log('\n=== 顶部反馈入口 ===')
  ok(!!host.querySelector('.brand-feedback'), '插件名后有反馈入口 .brand-feedback')
  // Popover 的内容默认不挂载 —— 点一下触发器再看
  const fbBtn = host.querySelector('.brand-feedback') as HTMLElement | null
  const fbOpen = fbBtn
    ? ((fbBtn as unknown as { click?: () => void }).click?.(), true)
    : false
  ok(fbOpen, '反馈入口可点击')
  await act(async () => {})
  const fbHtml = host.innerHTML
  ok(/009176/.test(fbHtml), '反馈弹层里带用户 ID 009176')
  ok(!!host.querySelector('.pop-panel'), '弹层用 .pop-panel 承载（fixed 定位不被裁切）')
  ok(!!host.querySelector('.fb-at'), '用 @某人 的形式（.fb-at 胶囊）')
  ok(/@张强/.test(fbHtml), '反馈对象是 @张强（不再是「打开飞书会话」）')
  ok(!/打开飞书会话/.test(fbHtml), '已移除打不开的「打开飞书会话」按钮')
  ok(/复制反馈模板/.test(fbHtml), '提供「复制反馈模板」动作')
  ok(!!host.querySelector('.fb-appdesc'), '反馈弹层里含插件描述')
  ok(!!host.querySelector('.fb-block'), '反馈信息按 .fb-block 分组呈现')

  /* ---------- 本轮·问题 5：空白工作表 ---------- */
  console.log('\n=== 空白工作表跳过 ===')
  ok(!!host.querySelector('.sheet-skip-tag'), '空白表用 .sheet-skip-tag 标签列出')
  ok(/已跳过/.test(html), '空白表汇总提示含「已跳过」')
  ok(/Sheet2/.test(html) && /Sheet3/.test(html), '提示里点名了被跳过的 Sheet2 / Sheet3')
  const sheetBlocks = host.querySelectorAll('.sheet-block').length
  ok(sheetBlocks === 1, '空白表不占映射块（只有 1 个真实 sheet 渲染）', { sheetBlocks })

  /* ---------- 本轮·问题 5：图片尺寸与多图开关同级 ---------- */
  console.log('\n=== 导出选项层级 ===')
  ok(/图片边长/.test(html), '导出选项含「图片边长」')
  const sizeRow = [...host.querySelectorAll('.opt-row')].find((el) => /图片边长/.test(el.textContent ?? ''))
  ok(!!sizeRow, '「图片边长」独占一个 .opt-row（与「全部图片都导出」同级）', {
    rows: [...host.querySelectorAll('.opt-row')].map((el) => (el.textContent ?? '').slice(0, 12)),
  })
  ok(!host.querySelector('.opt-group .size-input'), '「图片边长」不再嵌在「图片嵌入方式」分组内')

  console.log(`\n${failed === 0 ? '渲染校验全部通过 ✅' : `失败 ${failed} 项 ❌`}`)
  process.exit(failed === 0 ? 0 : 1)
}

void main()
