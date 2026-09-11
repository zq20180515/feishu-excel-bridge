/**
 * 最近一次导入 / 导出的运行日志。
 *
 * 为什么需要它：用户遇到问题去反馈时，往往已经离开了那个页面，
 * 日志也早就没了 —— 每次都只能让用户描述「大概卡在哪」。
 * 这里把最近一次的运行摘要落到本地存储，反馈入口可以直接一键复制。
 */

const KEY = 'btnexcel:last-run'

export type RunLogKind = 'import' | 'export'

export type RunLog = {
  kind: RunLogKind
  /** 完成时间（毫秒时间戳） */
  at: number
  /** 源文件名（导入时有；导出时是产物名） */
  fileName?: string
  /** 一行摘要，如「1 张表 · 6 字段 · 91 行」 */
  summary: string
  /** 完整日志行 */
  lines: string[]
}

/** 日志行数上限，避免把存储写爆 */
const MAX_LINES = 200

export function saveRunLog(entry: RunLog): void {
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ ...entry, lines: entry.lines.slice(-MAX_LINES) }),
    )
  } catch {
    /* 存储不可用（隐私模式 / 配额满）时静默忽略，不影响主流程 */
  }
}

export function readRunLog(): RunLog | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RunLog
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.lines)) return null
    return parsed
  } catch {
    return null
  }
}

export function clearRunLog(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* 忽略 */
  }
}

/** 最近一次运行的时间描述，如「2026/09/11 21:30:05」 */
export function describeRunTime(entry: RunLog): string {
  try {
    return new Date(entry.at).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return '—'
  }
}

/** 格式化成可直接粘进飞书的文本 */
export function formatRunLog(entry: RunLog, appVersion: string): string {
  return [
    `【最近一次${entry.kind === 'import' ? '导入' : '导出'}】`,
    `时间：${describeRunTime(entry)}`,
    entry.fileName ? `文件：${entry.fileName}` : '',
    `结果：${entry.summary}`,
    `插件版本：${appVersion}`,
    '',
    '—— 运行日志 ——',
    ...entry.lines,
  ]
    .filter((l) => l !== '')
    .join('\n')
}
