import { useRef, useState } from 'react'
import {
  Card,
  CompletionCard,
  Notice,
  RingProgress,
  Segmented,
  Tip,
  formatBytes,
  formatDuration,
  useSinceUpdate,
} from './ui'
import type { ProgressStageDef } from './ui'
import {
  IconDownload,
  IconFolder,
  IconImage,
  IconInfo,
  IconRefresh,
  IconTable,
  IconWarn,
} from './icons'
import { revealExportFile, runExport, triggerDownload } from '../lib/exporter'
import type { ExportMediaSession, ExportProgress, ExportResult, MediaFailure } from '../lib/exporter'
import type { TableBrief } from '../lib/types'

type Props = {
  tables: TableBrief[]
  reloadTables: () => Promise<void>
}

type ImageMode = 'dispimg' | 'float'
/** 打包方式：一个 Excel 还是按表拆成多个（zip） */
type PackMode = 'single' | 'perTable'
/** 面板状态：配置 → 运行中 →（图片有失败时）待确认 → 已完成 */
type Phase = 'config' | 'running' | 'review' | 'done'

const MODE_TIP: Record<ImageMode, string> = {
  dispimg:
    '图片真正住在单元格里，随行高列宽一起显示；需要 WPS 打开才能看到，原生 Excel 会显示为 =DISPIMG(...) 公式。',
  float: '标准浮动图片锚定在单元格上，Excel / WPS / LibreOffice 都能正常显示，兼容性最好。',
}

const PACK_TIP: Record<PackMode, string> = {
  single: '所有选中的数据表写进同一个 Excel，每张表对应一个工作表。适合汇总归档。',
  perTable: '每张数据表单独一个 Excel，打包成 zip 下载。只有一张表时会直接给 xlsx。',
}

/** 阶段清单（与 exporter.ts 的 ExportStage 对应） */
const EXPORT_STAGES: ProgressStageDef[] = [
  { key: 'read', label: '读取数据表' },
  { key: 'fetch', label: '拉取字段与记录' },
  { key: 'media', label: '下载附件图片' },
  { key: 'pack', label: '嵌入图片并生成 Excel' },
]

export default function ExportPanel({ tables, reloadTables }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /**
   * 「是否把图片嵌入单元格」不再单独给开关 —— 下面的「图片嵌入方式」
   * 本身已经表达了这件事，两个控件并列只会让人犹豫。
   */
  const embedImages = true
  const [imageMode, setImageMode] = useState<ImageMode>('dispimg')
  const [packMode, setPackMode] = useState<PackMode>('single')
  const [allImages, setAllImages] = useState(true)
  /** 默认不勾选 —— 大多数场景不需要额外这一列，勾了反而让表格变宽 */
  const [attachmentNameColumn, setAttachmentNameColumn] = useState(false)
  /** '' = 原图原尺寸 */
  const [imageSize, setImageSize] = useState('')
  const [maxImageMb, setMaxImageMb] = useState(10)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<Phase>('config')
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState('')
  const [locating, setLocating] = useState(false)
  const [revealMsg, setRevealMsg] = useState<{ kind: 'info' | 'ok' | 'warn'; text: string } | null>(null)
  /** 图片下载有失败项时停在这里，等用户决定「逐张重试」还是「跳过」 */
  const [mediaReview, setMediaReview] = useState<{
    failures: MediaFailure[]
    retry: ExportMediaSession['retry']
  } | null>(null)
  /** 正在重试的失败项 id（空数组 = 当前没有重试在跑） */
  const [retrying, setRetrying] = useState<string[]>([])
  /** onMediaReady 挂起期间保存的 resolve；用户点按钮后放行 */
  const resolveRef = useRef<((v: 'continue' | 'abort') => void) | null>(null)
  /** 距上次进度更新过了多久（导出时同样会有一段界面不动的等待期） */
  const waiting = useSinceUpdate(progress)

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allOn = tables.length > 0 && selected.size === tables.length

  const parsedSize = Number(imageSize.replace(/\D/g, '')) || 0

  /** 完成态统计 */
  const totalImages = result?.summary.reduce((n, s) => n + s.images, 0) ?? 0
  const totalRecords = result?.summary.reduce((n, s) => n + s.records, 0) ?? 0
  const sizeMb = result ? (result.blob.size / 1024 / 1024).toFixed(1) : '0'

  /** 阶段清单：给「下载附件图片」挂上每张图的明细，可展开查看 */
  const stages: ProgressStageDef[] = EXPORT_STAGES.map((s) => {
    if (s.key !== 'media') return s
    const onMedia = progress?.stage === 'media'
    return {
      ...s,
      summary:
        onMedia && progress && progress.total > 1 ? `${progress.done} / ${progress.total}` : undefined,
      items: onMedia ? progress?.items : undefined,
    }
  })

  const doExport = async () => {
    if (!selected.size) return
    setBusy(true)
    setError('')
    setResult(null)
    setRevealMsg(null)
    setPhase('running')
    try {
      const res = await runExport({
        tableIds: [...selected],
        imageMode,
        embedImages,
        packMode,
        allImages,
        attachmentNameColumn,
        // 0 / 空 → 原图原尺寸
        imageSizePx: parsedSize > 0 ? Math.min(2000, Math.max(16, parsedSize)) : undefined,
        maxImageMb,
        /**
         * 有图片没下下来时**先不打包**，停在这一步让用户逐张重试或跳过。
         * 否则用户只会看到「有 N 张失败」，却不知道该补哪几张。
         * 这里返回一个挂起的 Promise，由界面上的按钮来放行。
         */
        onMediaReady: (session) => {
          setMediaReview({ failures: session.failures, retry: session.retry })
          setPhase('review')
          return new Promise<'continue' | 'abort'>((resolve) => {
            resolveRef.current = resolve
          })
        },
        onProgress: (p) => setProgress(p),
      })
      setResult(res)
      triggerDownload(res.blob, res.fileName)
      setPhase('done')
    } catch (e) {
      setError(`导出失败：${String((e as Error)?.message ?? e)}`)
      setPhase('config')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  /** 重试失败项；不传 ids = 全部重试。全部成功则自动放行去打包 */
  const retryFailures = async (ids?: string[]) => {
    if (!mediaReview) return
    const targets = ids ?? mediaReview.failures.map((f) => f.id)
    setRetrying(targets)
    try {
      const still = await mediaReview.retry(targets)
      const stillIds = new Set(still.map((s) => s.id))
      // 本次重试过的项里，没出现在 still 中的就是成功了
      const next = mediaReview.failures
        .filter((f) => !targets.includes(f.id) || stillIds.has(f.id))
        .map((f) => still.find((s) => s.id === f.id) ?? f)
      setMediaReview({ ...mediaReview, failures: next })
      if (next.length === 0) {
        resolveRef.current?.('continue')
        resolveRef.current = null
        setMediaReview(null)
        setPhase('running')
      }
    } finally {
      setRetrying([])
    }
  }

  /** 跳过失败的图片继续导出（它们在 Excel 里是空单元格） */
  const skipFailures = () => {
    resolveRef.current?.('continue')
    resolveRef.current = null
    setMediaReview(null)
    setPhase('running')
  }

  /** 「打开文件所在位置」：插件 iframe 没有文件系统权限，只能请用户挑目录或引导到下载文件夹 */
  const doReveal = async () => {
    if (!result) return
    setLocating(true)
    setRevealMsg(null)
    try {
      const outcome = await revealExportFile(result.blob, result.fileName)
      if (outcome === 'picked') {
        setRevealMsg({ kind: 'ok', text: `已保存为「${result.fileName}」，系统已跳转到你选定的文件夹。` })
      } else if (outcome === 'fallback') {
        setRevealMsg({
          kind: 'info',
          text: `插件运行在受限的 iframe 里，无法直接打开系统文件夹。已为你重新拉起一次下载：${result.fileName} —— 请点浏览器右上角的下载按钮，或前往「下载」文件夹查看。`,
        })
      }
    } finally {
      setLocating(false)
    }
  }

  /* ==================== 运行中：整页只留进度 ==================== */
  if (phase === 'running') {
    return (
      <div className="run-page">
        <RingProgress
          tone="export"
          indeterminate={!progress}
          done={progress?.done ?? 0}
          total={progress?.total ?? 0}
          label={progress?.phase ?? '正在准备'}
          detail={progress?.detail}
          ringCaption="已导出"
          stages={stages}
          currentStage={progress?.stage}
        />
        <div className="footer-bar">
          <span className={waiting >= 60 ? 'muted wait-slow' : 'muted'}>
            导出中{progress?.total ? ` · 已处理 ${progress.done} / ${progress.total}` : ''}
            {waiting >= 8 ? ` · 当前步骤 ${formatDuration(waiting)}` : ''}
            {waiting >= 60 ? '（仍在处理）' : ''}
          </span>
        </div>
      </div>
    )
  }

  /* ==================== 有图片失败：停下来让用户决定 ==================== */
  if (phase === 'review' && mediaReview) {
    const failCount = mediaReview.failures.length
    return (
      <div className="run-page">
        <div className="review-wrap">
          <div className="review-icon">
            <IconWarn size={30} />
          </div>
          <h2>有 {failCount} 张图片没下载成功</h2>
          <p>
            可以点右侧的刷新按钮逐张重试，或直接跳过。
            <br />
            跳过的图片在导出的 Excel 里会是空单元格。
          </p>
        </div>

        <div className="review-list">
          {mediaReview.failures.map((f) => {
            const busy = retrying.includes(f.id)
            return (
              <div className="review-item" key={f.id}>
                <span className="review-main">
                  <span className="review-name" title={`${f.tableName} · ${f.name}`}>
                    {f.name}
                  </span>
                  <span className="review-sub">
                    {formatBytes(f.size)} · {f.reason}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn ghost xs review-retry"
                  title={busy ? '正在重新下载…' : '重新下载这一张'}
                  aria-label={`重新下载 ${f.name}`}
                  disabled={busy}
                  onClick={() => void retryFailures([f.id])}
                >
                  <span className={busy ? 'icon-only rotating' : 'icon-only'}>
                    <IconRefresh size={13} />
                  </span>
                </button>
              </div>
            )
          })}
        </div>

        <div className="done-actions">
          <button className="btn ghost" onClick={skipFailures}>
            跳过，继续导出
          </button>
          <button className="btn primary" disabled={retrying.length > 0} onClick={() => void retryFailures()}>
            {retrying.length > 0 ? '重试中…' : `全部重试（${failCount}）`}
          </button>
        </div>
        <div className="note-line">下载失败多是临时链接失效或网络抖动，重试通常就能成功</div>
      </div>
    )
  }

  /* ==================== 已完成：整页只留结果 ==================== */
  if (phase === 'done' && result) {
    return (
      <div className="done-page">
        <CompletionCard
          title="导出完成"
          subtitle={result.fileName}
          stats={[
            { v: result.summary.length, k: '工作表' },
            { v: totalImages, k: '嵌入图片' },
            { v: sizeMb, k: 'MB 文件' },
            { v: totalRecords, k: '行记录' },
          ]}
          actions={
            <>
              <button className="btn ghost" onClick={() => setPhase('config')}>
                返回
              </button>
              <button className="btn primary" onClick={() => triggerDownload(result.blob, result.fileName)}>
                <IconDownload size={14} />
                再下载一次
              </button>
            </>
          }
          note={
            result.fileCount > 1
              ? `${result.fileCount} 个 Excel 已打包为 zip；图片以${
                  imageMode === 'dispimg' ? ' WPS 嵌入' : '标准浮动'
                }方式写入`
              : imageMode === 'dispimg'
                ? '图片以 WPS 嵌入方式写入，用 WPS 打开可见'
                : '图片以标准浮动方式写入，Excel / WPS 都能显示'
          }
        >
          <div className="result-list" style={{ marginTop: 16 }}>
            {result.summary.map((s, i) => (
              <div className="result-item" key={i}>
                <span className="result-name" title={s.table}>
                  {s.table}
                </span>
                <span className="muted">{s.records} 条记录</span>
                <span className="badge acc">
                  <IconImage size={11} />
                  {s.images}
                </span>
              </div>
            ))}
          </div>

          {result.warnings.map((w, i) => (
            <Notice kind="warn" key={`w${i}`}>
              {w}
            </Notice>
          ))}
          {result.errors.length > 0 && <div className="log">{result.errors.slice(0, 50).join('\n')}</div>}
          {revealMsg && <Notice kind={revealMsg.kind}>{revealMsg.text}</Notice>}

          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <button className="btn link" onClick={() => void doReveal()} disabled={locating}>
              {locating ? '正在定位…' : '打开文件所在位置'}
            </button>
          </div>
        </CompletionCard>
      </div>
    )
  }

  return (
    <>
      <Card
        title="选择要导出的数据表"
        hint="可多选，每张表导出为 Excel 的一个工作表"
        extra={
          tables.length > 0 ? (
            <button
              className="btn ghost xs"
              onClick={() => setSelected(allOn ? new Set() : new Set(tables.map((t) => t.id)))}
            >
              {allOn ? '取消全选' : '全选'}
            </button>
          ) : null
        }
      >
        {tables.length === 0 ? (
          <div className="empty">当前多维表格里还没有数据表</div>
        ) : (
          <div className="pick-grid">
            {tables.map((t) => {
              const on = selected.has(t.id)
              return (
                <label className={on ? 'pick on' : 'pick'} key={t.id}>
                  <input type="checkbox" checked={on} onChange={() => toggle(t.id)} />
                  <span className="pick-icon">
                    <IconTable size={15} />
                  </span>
                  <span className="pick-name" title={t.name}>
                    {t.name}
                  </span>
                </label>
              )
            })}
          </div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn ghost xs" onClick={() => void reloadTables()} disabled={busy}>
            <IconRefresh size={13} />
            刷新列表
          </button>
          <span className="muted">已选 {selected.size} 张</span>
        </div>
      </Card>

      <Card title="导出选项">
        {/* 导出方式：合并成一个 Excel，还是按数据表拆成多个 */}
        <div className="opt-group">
          <div className="opt-label">导出方式</div>
          <Segmented<PackMode>
            value={packMode}
            ariaLabel="导出方式"
            options={[
              { value: 'single', label: '合并为一个 Excel' },
              { value: 'perTable', label: '拆分多个 Excel' },
            ]}
            onChange={setPackMode}
          />
          <div className="opt-note">{PACK_TIP[packMode]}</div>
        </div>

        {/* 图片嵌入方式 */}
        <div className="opt-group">
          <div className="opt-label">图片嵌入方式</div>
          <Segmented<ImageMode>
            value={imageMode}
            ariaLabel="图片嵌入方式"
            options={[
              { value: 'dispimg', label: 'WPS嵌入单元格图片', icon: <IconImage size={14} /> },
              { value: 'float', label: '标准浮动图片', icon: <IconImage size={14} /> },
            ]}
            onChange={setImageMode}
          />
          <div className="opt-note">{MODE_TIP[imageMode]}</div>
        </div>

        {/* 图片尺寸 —— 两种嵌图方式都生效 */}
        <div className="opt-row">
          <span className="opt-name">图片边长</span>
          <span className="opt-ctl">
            <input
              className="input size-input"
              inputMode="numeric"
              placeholder="原图"
              value={imageSize}
              onChange={(e) => setImageSize(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
            <span className="muted">px</span>
            <Tip text="留空 = 原图原尺寸（推荐）。填数字 = 等比缩放到该边长，让表格更紧凑。两种嵌图方式都生效。">
              <span className="help-dot">
                <IconInfo size={12} />
              </span>
            </Tip>
          </span>
        </div>

        {/* 多图处理 */}
        <div className="opt-row">
          <label className="check">
            <input type="checkbox" checked={allImages} onChange={(e) => setAllImages(e.target.checked)} />
            <span>全部图片都导出</span>
          </label>
          <span className="opt-hint">{allImages ? '照片 / 照片2 / 照片3…' : '只嵌第一张'}</span>
        </div>

        {/* 附件名列（默认不勾选） */}
        <div className="opt-row">
          <label className="check">
            <input
              type="checkbox"
              checked={attachmentNameColumn}
              onChange={(e) => setAttachmentNameColumn(e.target.checked)}
            />
            <span>额外输出「附件名」列</span>
          </label>
          <span className="opt-hint">纯文本文件名</span>
        </div>

        {/* 单个附件的大小上限 */}
        <div className="opt-row">
          <span className="opt-name">跳过超过</span>
          <span className="opt-ctl">
            <input
              className="input size-input"
              inputMode="numeric"
              value={maxImageMb}
              onChange={(e) => setMaxImageMb(Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 10))}
            />
            <span className="muted">MB 的附件</span>
          </span>
        </div>
      </Card>

      {error && <Notice kind="err">{error}</Notice>}

      <div className="footer-bar">
        <span className="muted">
          已选 {selected.size} 张
          {` · ${imageMode === 'dispimg' ? 'WPS 嵌入' : '标准浮动'}`}
          {` · ${packMode === 'single' ? '合并' : '拆分'}`}
          {allImages ? ' · 全部图片分列' : ''}
        </span>
        <button
          className="btn primary"
          style={{ marginLeft: 'auto' }}
          disabled={busy || selected.size === 0}
          onClick={() => void doExport()}
        >
          <IconDownload size={14} />
          导出并下载
        </button>
      </div>
    </>
  )
}
