/**
 * 生成 UI 预览页：用**真实组件**渲染 7 个界面状态，输出成一个可直接打开的 HTML。
 *
 * 用途：UI 改版后肉眼验收 —— 不用装飞书宿主、不用起开发服务器，
 * 双击 design-preview.html 就能看到每个状态长什么样。
 *
 * 与 test/ui.ts 的分工：那边断言结构，这边只负责「把它画出来给人看」。
 *
 * 运行：npm run preview:ui
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

import App from '../src/App'
import ImportPanel from '../src/components/ImportPanel'
import ExportPanel from '../src/components/ExportPanel'
import MappingEditor from '../src/components/MappingEditor'
import { Card, CompletionCard, RingProgress, Steps } from '../src/components/ui'
import type { SourceSheet } from '../src/lib/types'

const ROOT = resolve(__dirname, '..')
const CSS = readFileSync(resolve(ROOT, 'src/styles.css'), 'utf8')

const noop = async () => {}

/* ---------------------------- 演示数据 ---------------------------- */

const tables = [
  { id: 'tbl1', name: '办公用品申请表' },
  { id: 'tbl2', name: '2024 年度采购台账' },
  { id: 'tbl3', name: '供应商名录' },
]

function col(
  i: number,
  header: string,
  type: number,
  opts: { valueCount?: number; mediaCount?: number; enabled?: boolean } = {},
) {
  return {
    key: `s::${i}`,
    sheet: '员工档案',
    col: i,
    letter: String.fromCharCode(65 + i),
    header,
    samples: [],
    valueCount: opts.valueCount ?? 91,
    mediaCount: opts.mediaCount ?? 0,
    inferredType: type,
    enabled: opts.enabled ?? true,
    targetFieldId: '',
    targetFieldName: header,
    targetFieldType: type,
    typeTouched: false,
  }
}

const sheets: SourceSheet[] = [
  {
    name: '员工档案',
    matrix: [],
    headerRowIndex: 0,
    totalDataRows: 91,
    mediaByCell: new Map(),
    importTableName: '员工档案',
    importMode: 'create',
    importTableId: '',
    columns: [
      col(0, '云南贝泰妮生物科技集团股份有限公司采购部名称全称', 1),
      col(1, '部门', 3, { valueCount: 87 }),
      col(2, '工号', 1, { valueCount: 89 }),
      col(3, '入职日期', 1001, { valueCount: 90 }),
      col(4, '照片', 17, { valueCount: 0, mediaCount: 26 }),
      col(5, '是否转正', 7, { valueCount: 6, enabled: false }),
    ],
  },
]

const FRAME_W = 400

/* ---------------------------- 渲染工具 ---------------------------- */

/** 把组件渲染成一个独立的 iframe 文档（样式隔离 + 模拟 400px 侧栏） */
function frame(title: string, desc: string, node: ReturnType<typeof createElement>, h = 760) {
  const body = renderToStaticMarkup(node)
  const srcdoc = [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    `<style>${CSS}</style>`,
    '</head><body>',
    body,
    '</body></html>',
  ].join('')

  // 放进 HTML 属性里必须转义：& 先于 " —— 否则原本的 &amp; 会被二次解析
  const esc = srcdoc.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

  return `
    <section class="pv">
      <header class="pv-h">
        <h2>${title}</h2>
        <p>${desc}</p>
      </header>
      <iframe class="pv-f" width="${FRAME_W}" height="${h}" srcdoc="${esc}" loading="lazy"></iframe>
    </section>`
}

/** 面板统一包一层 App 外壳（顶栏 + body + stack） */
function panelShell(inner: ReturnType<typeof createElement>) {
  const app = renderToStaticMarkup(createElement(App, null))
  // 从 App 的渲染结果里取出真实顶栏，保证预览与线上完全一致
  const m = app.match(/<header class="topbar">[\s\S]*?<\/header>/)
  const topbar = m ? m[0] : ''
  return createElement('div', { className: 'app' }, createElement(Topbar, { html: topbar }), inner)
}

/** 直接注入已渲染好的顶栏 HTML */
function Topbar({ html }: { html: string }) {
  return createElement('span', { dangerouslySetInnerHTML: { __html: html }, style: { display: 'contents' } })
}

function body(...children: ReturnType<typeof createElement>[]) {
  return createElement('main', { className: 'body' }, createElement('div', { className: 'stack' }, ...children))
}

/* ---------------------------- 生成 ---------------------------- */

const views: string[] = []

// ① 导入空态
views.push(
  frame(
    '① 导入 · 空态',
    '步骤条 + hero 空态 + 拖放区 + 文件类型徽章',
    panelShell(
      body(
        createElement(Steps, { items: ['选文件', '字段映射', '导入'], current: 0 }),
        createElement(ImportPanel, { tables: [], reloadTables: noop }),
      ),
    ),
  ),
)

// ② 字段映射
views.push(
  frame(
    '② 导入 · 字段映射',
    '工作表折叠块 + 目标表选择 + 字段行（类型胶囊可展开）+ 底部操作栏',
    panelShell(
      body(
        createElement(Steps, { items: ['选文件', '字段映射', '导入'], current: 1 }),
        createElement(
          Card,
          { title: '字段映射', hint: '每个工作表单独成表；取消勾选 = 不导入该字段；类型可改' },
          createElement(MappingEditor, {
            sheets,
            tables,
            onChange: () => {},
            onLoadFields: async () => [],
          }),
        ),
      ),
    ),
    900,
  ),
)

// ③ 导入中
views.push(
  frame(
    '③ 导入 · 进行中',
    '环形进度 + 阶段清单 + 底部栏',
    panelShell(
      body(
        createElement(Steps, { items: ['选文件', '字段映射', '导入'], current: 2 }),
        createElement(
          Card,
          { title: '执行进度' },
          createElement(RingProgress, {
            done: 62,
            total: 91,
            label: '正在写入记录',
            detail: '第 62 / 91 行 · 字段映射自动套用',
          }),
          createElement(
            'div',
            { className: 'log', style: { marginTop: 10 } },
            '已解析「员工档案.xlsx」：1 个工作表\n  · 员工档案：91 行数据，6 列，识别到 26 个图片/附件\n正在创建字段…\n正在写入记录 62/91',
          ),
        ),
      ),
    ),
  ),
)

// ④ 导入完成
views.push(
  frame(
    '④ 导入 · 完成',
    '大对勾 + 4 格统计 + 明细 + 主按钮',
    panelShell(
      body(
        createElement(Steps, { items: ['选文件', '字段映射', '导入'], current: 3 }),
        createElement(
          Card,
          null,
          createElement(
            CompletionCard,
            {
              title: '导入完成',
              subtitle: '1 张数据表已写入当前多维表格',
              stats: [
                { v: 1, k: '数据表' },
                { v: 6, k: '字段' },
                { v: 91, k: '行记录' },
                { v: 26, k: '附件图片' },
              ],
              actions: createElement('button', { className: 'btn primary' }, '再导入一个'),
              note: '同名数据表已自动加序号，可在左侧数据表列表查看',
            },
            createElement(
              'div',
              { className: 'result-list', style: { marginTop: 14 } },
              createElement(
                'div',
                { className: 'result-item' },
                createElement('span', { className: 'result-name' }, '员工档案'),
                createElement('span', { className: 'muted' }, '新建 6 字段'),
                createElement('span', { className: 'muted' }, '复用 0'),
                createElement('span', { className: 'badge ok' }, '91 条'),
              ),
            ),
          ),
        ),
      ),
    ),
  ),
)

// ⑤ 导出配置
views.push(
  frame(
    '⑤ 导出 · 配置',
    '数据表多选 + 行式导出选项 + 底部栏',
    panelShell(
      body(createElement(ExportPanel, { tables, reloadTables: noop })),
    ),
    1000,
  ),
)

// ⑥ 导出中
views.push(
  frame(
    '⑥ 导出 · 进行中',
    '环形进度（导出配色为蓝）+ 阶段明细',
    panelShell(
      body(
        createElement(
          Card,
          { title: '导出进度' },
          createElement(RingProgress, {
            tone: 'export',
            done: 12,
            total: 26,
            label: '正在下载附件图片',
            detail: '办公用品申请表 · 第 12 / 26 张图片',
          }),
        ),
      ),
    ),
  ),
)

// ⑦ 导出完成
views.push(
  frame(
    '⑦ 导出 · 完成',
    '大对勾 + 4 格统计 + 双按钮（再下载 / 打开位置）',
    panelShell(
      body(
        createElement(
          Card,
          null,
          createElement(
            CompletionCard,
            {
              title: '导出完成',
              subtitle: 'BTNExcel-导出-20260911.xlsx',
              stats: [
                { v: 2, k: '工作表' },
                { v: 26, k: '嵌入图片' },
                { v: 91, k: '行记录' },
                { v: '3.4', k: 'MB 文件' },
              ],
              actions: createElement(
                'span',
                { style: { display: 'contents' } },
                createElement('button', { className: 'btn ghost' }, '再下载一次'),
                createElement('button', { className: 'btn primary' }, '打开文件位置'),
              ),
              note: '图片以 WPS 嵌入方式写入，用 WPS 打开可见',
            },
            createElement(
              'div',
              { className: 'result-list', style: { marginTop: 14 } },
              createElement(
                'div',
                { className: 'result-item' },
                createElement('span', { className: 'result-name' }, '办公用品申请表'),
                createElement('span', { className: 'muted' }, '91 条记录'),
                createElement('span', { className: 'badge acc' }, '26'),
              ),
              createElement(
                'div',
                { className: 'result-item' },
                createElement('span', { className: 'result-name' }, '2024 年度采购台账'),
                createElement('span', { className: 'muted' }, '48 条记录'),
                createElement('span', { className: 'badge acc' }, '12'),
              ),
            ),
          ),
        ),
      ),
    ),
  ),
)

const page = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BTNExcel 桥 · UI 重设计预览</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 36px 24px 64px;
    background: radial-gradient(1000px 500px at 50% -8%, #f1f3f7 0%, transparent 60%), #e7e9ed;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif;
    color: #0f172a;
    -webkit-font-smoothing: antialiased;
  }
  .pv-head { max-width: 1080px; margin: 0 auto 28px; }
  .pv-head h1 { margin: 0; font-size: 20px; font-weight: 650; letter-spacing: .2px; }
  .pv-head p { margin: 6px 0 0; font-size: 13px; color: #475569; line-height: 1.7; }
  .pv-head .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
  .pv-head .tag {
    font-size: 11.5px; padding: 3px 10px; border-radius: 999px;
    background: #fff; border: 1px solid #e2e8f0; color: #475569;
  }
  .pv-head .tag b { color: #0f766e; }
  .pv-grid {
    display: grid; gap: 28px;
    grid-template-columns: repeat(auto-fill, minmax(${FRAME_W}px, 1fr));
    justify-items: center;
    max-width: 1360px; margin: 0 auto;
  }
  .pv { display: flex; flex-direction: column; gap: 10px; }
  .pv-h { padding-left: 2px; }
  .pv-h h2 { margin: 0; font-size: 14px; font-weight: 620; }
  .pv-h p { margin: 4px 0 0; font-size: 11.5px; color: #64748b; line-height: 1.6; }
  .pv-f {
    border: 0; border-radius: 18px; background: #fff;
    box-shadow: 0 30px 70px -20px rgba(15,23,42,.25), 0 6px 20px rgba(15,23,42,.08);
    display: block;
  }
</style>
</head>
<body>
  <div class="pv-head">
    <h1>BTNExcel 桥 · UI 重设计预览</h1>
    <p>以下 7 个界面由<b>真实 React 组件</b>渲染（非静态摹本），样式取自 <code>src/styles.css</code>，每个状态独立在 400px 侧栏宽度的 iframe 内，与插件实际运行环境一致。</p>
    <div class="tags">
      <span class="tag">强调色 <b>teal #0f766e</b></span>
      <span class="tag">主按钮 <b>近黑 #0f172a</b></span>
      <span class="tag">圆角 <b>12–14px</b></span>
      <span class="tag">侧栏宽 <b>400px</b></span>
    </div>
  </div>
  <div class="pv-grid">
    ${views.join('\n')}
  </div>
</body>
</html>
`

const out = resolve(ROOT, 'design-preview.html')
writeFileSync(out, page, 'utf8')
console.log(`已生成 ${out}（${(page.length / 1024).toFixed(1)} KB，${views.length} 个视图）`)
