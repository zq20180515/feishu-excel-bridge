import { useCallback, useEffect, useRef, useState } from 'react'
import ImportPanel from './components/ImportPanel'
import ExportPanel from './components/ExportPanel'
import { listTables, sdkAvailable } from './lib/base-api'
import type { TableBrief } from './lib/types'
import { Notice, Popover, copyText } from './components/ui'
import { describeRunTime, formatRunLog, readRunLog } from './lib/diag-log'
import type { RunLog } from './lib/diag-log'
import { IconCheck, IconDownload, IconFeedback, IconSheetImage, IconUpload } from './components/icons'

const APP_NAME = 'BTNExcel 桥'
const APP_TAGLINE = '原样导入 / 带图导出'

/** 反馈接收人（飞书 user_id） */
const FEEDBACK_USER_ID = '009176'
/** 反馈接收人姓名 —— 用「@张强」的形式，而不是打开会话 */
const FEEDBACK_USER_NAME = '张强'

/** 插件描述：反馈时带上，方便定位问题 */
const APP_DESCRIPTION = `Excel ⇄ 多维表格 双向桥接插件。导入侧把本地表格的图片/视频解析成附件字段，
并按字段一一映射写入（支持多 sheet、单选/多选、追加到已有数据表）；导出侧把附件里的图片嵌回单元格
（WPS 嵌入单元格图片 / 标准浮动图片两种模式，支持多图分列）。`

function FeedbackEntry() {
  const [copied, setCopied] = useState(false)
  const [copiedAll, setCopiedAll] = useState(false)
  const [copiedLog, setCopiedLog] = useState(false)
  const timer = useRef<number | null>(null)
  const appVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  /** 复制走 ui.tsx 里统一的实现（剪贴板被沙箱拒绝时退化为 execCommand） */
  const copy = copyText

  const flash = (set: (v: boolean) => void) => {
    set(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => set(false), 1800)
  }

  const copyId = async () => {
    await copy(FEEDBACK_USER_ID)
    flash(setCopied)
  }

  /** 复制一段可以直接粘进飞书的完整反馈模板 */
  const copyTemplate = async () => {
    await copy(
      [
        `@${FEEDBACK_USER_NAME} 反馈 BTNExcel 桥`,
        '',
        `【插件】${APP_NAME} —— ${APP_TAGLINE}`,
        `【版本】${appVersion}`,
        '【问题描述】（请写清楚：哪个 sheet / 哪一列 / 期望什么、实际什么）',
        '【截图】（可直接粘贴截图）',
      ].join('\n'),
    )
    flash(setCopiedAll)
  }

  /** 复制「最近一次导入/导出」的完整日志 —— 出问题时最有用的一条 */
  const copyRunLog = async (entry: RunLog) => {
    await copy(formatRunLog(entry, appVersion))
    flash(setCopiedLog)
  }

  return (
    <Popover
      ariaLabel="问题反馈"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          className="brand-feedback"
          title="遇到问题？点这里反馈"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
        >
          <IconFeedback size={12} />
          反馈
        </button>
      )}
    >
      {({ close }) => {
        // 每次打开都重新读 —— Popover 的内容是打开时才挂载的，
        // 这样导入/导出完立刻点反馈就能看到刚刚那一次的日志
        const lastRun = readRunLog()
        return (
          <span className="fb-body">
            <span className="fb-title">
              <IconFeedback size={13} />
              问题反馈
            </span>

            <span className="fb-desc">
              插件无法替你直接打开飞书对话框，请复制下面的信息，粘到飞书里
              <b className="fb-at">@{FEEDBACK_USER_NAME}</b>
              并附上截图。
            </span>

            <span className="fb-block">
              <span className="fb-block-label">反馈对象</span>
              <span className="fb-none">
                <span className="fb-at">@{FEEDBACK_USER_NAME}</span>
                <span className="fb-uid">{FEEDBACK_USER_ID}</span>
              </span>
            </span>

            {/* 最近一次运行：出问题时最有用的一条信息 */}
            <span className="fb-block">
              <span className="fb-block-label">最近一次运行</span>
              {lastRun ? (
                <>
                  <span className="fb-run">
                    {lastRun.kind === 'import' ? '导入 Excel' : '导出 Excel'}
                    <span className="fb-run-time">{describeRunTime(lastRun)}</span>
                  </span>
                  <span className="fb-run-sum" title={lastRun.summary}>
                    {lastRun.summary}
                  </span>
                </>
              ) : (
                <span className="fb-run-empty">还没有记录 —— 导入或导出一次后这里会出现</span>
              )}
            </span>

            <span className="fb-block">
              <span className="fb-block-label">插件信息（复制时一并带上）</span>
              <span className="fb-desc-app">
                <b>{APP_NAME}</b>
                <span className="fb-ver">v{appVersion}</span>
              </span>
              <span className="fb-appdesc">{APP_DESCRIPTION}</span>
            </span>

            <span className="fb-actions">
              <button type="button" className="btn primary xs" style={{ flex: 1 }} onClick={() => void copyTemplate()}>
                {copiedAll ? <IconCheck size={12} /> : null}
                {copiedAll ? '已复制' : '复制反馈模板'}
              </button>
              <button type="button" className="btn ghost xs" onClick={() => void copyId()}>
                {copied ? <IconCheck size={12} /> : null}
                {copied ? '已复制' : '只复制 ID'}
              </button>
            </span>

            {lastRun && (
              <span className="fb-actions">
                <button
                  type="button"
                  className="btn ghost xs"
                  style={{ flex: 1 }}
                  onClick={() => void copyRunLog(lastRun)}
                >
                  {copiedLog ? <IconCheck size={12} /> : null}
                  {copiedLog ? '已复制' : '复制最近一次运行日志'}
                </button>
              </span>
            )}

            <span className="fb-actions">
              <button type="button" className="btn ghost xs" style={{ flex: 1 }} onClick={close}>
                关闭
              </button>
            </span>
          </span>
        )
      }}
    </Popover>
  )
}

/** 宿主环境的连接错误常常是英文原文（如 `time out`），翻译成能照着做的提示 */
function hostHint(): string {
  const here = typeof window !== 'undefined' ? window.location?.href ?? '' : ''
  return `如果你是在浏览器里直接打开本页面，请把${
    here ? `「${here}」` : '本页地址'
  }填入「多维表格 → 插件 → 自定义插件」后再试 —— 插件必须运行在多维表格宿主中，才能读写数据表。`
}

function humanizeHostError(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('time out') || m.includes('timeout')) {
    return `连接多维表格超时（SDK 返回：${msg}）。${hostHint()}`
  }
  if (m.includes('host not registered') || m.includes('not registered') || m.includes('bridge')) {
    return `未能与多维表格宿主通信（SDK 返回：${msg}）。${hostHint()}`
  }
  return msg
}

export default function App() {
  const [tab, setTab] = useState<'import' | 'export'>('import')
  const [tables, setTables] = useState<TableBrief[]>([])
  const [bootError, setBootError] = useState('')
  const [booting, setBooting] = useState(true)

  const reloadTables = useCallback(async () => {
    try {
      const list = await listTables()
      setTables(list)
      setBootError('')
    } catch (e) {
      setBootError(humanizeHostError(String((e as Error)?.message ?? e)))
    } finally {
      setBooting(false)
    }
  }, [])

  useEffect(() => {
    document.title = APP_NAME
    if (!sdkAvailable()) {
      setBootError(
        `未检测到多维表格插件宿主环境。如果你是在浏览器里直接打开本页面，这属于正常现象 —— ${hostHint()}此时界面仍可预览，但读写数据表的功能不可用。`,
      )
      setBooting(false)
      return
    }
    void reloadTables()
  }, [reloadTables])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <IconSheetImage size={19} />
          </span>
          <span className="brand-text">
            <span className="brand-main">
              <span className="brand-name">{APP_NAME}</span>
              <FeedbackEntry />
            </span>
            <span className="brand-sub">{APP_TAGLINE}</span>
          </span>
        </div>
        <div className="segmented tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'import'}
            className={tab === 'import' ? 'seg active' : 'seg'}
            onClick={() => setTab('import')}
          >
            <span className="seg-icon">
              <IconUpload size={14} />
            </span>
            <span className="seg-label">导入 Excel</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'export'}
            className={tab === 'export' ? 'seg active' : 'seg'}
            onClick={() => setTab('export')}
          >
            <span className="seg-icon">
              <IconDownload size={14} />
            </span>
            <span className="seg-label">导出为 Excel</span>
          </button>
        </div>
      </header>

      <main className="body">
        <div className="stack">
          {bootError && <Notice kind="err">{bootError}</Notice>}
          {booting && !bootError && <Notice>正在读取当前多维表格的数据表…</Notice>}

          {tab === 'import' ? (
            <ImportPanel tables={tables} reloadTables={reloadTables} />
          ) : (
            <ExportPanel tables={tables} reloadTables={reloadTables} />
          )}
        </div>
      </main>
    </div>
  )
}
