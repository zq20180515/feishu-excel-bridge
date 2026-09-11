import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MappingEditor from './MappingEditor'
import {
  Card,
  CompletionCard,
  Notice,
  RingProgress,
  Steps,
  Tip,
  copyText,
  formatBytes,
  formatDuration,
} from './ui'
import { IconImage, IconInfo, IconRetry, IconSheetImage, IconTable, IconUpload } from './icons'
import { listFields } from '../lib/base-api'
import { parseWorkbookFile } from '../lib/excel-read'
import { IMPORTABLE_FILE_TYPES, IMPORT_ACCEPT } from '../lib/field-meta'
import { runImport } from '../lib/importer'
import type { ImportProgress, ImportResult } from '../lib/importer'
import type { ParsedFile, SourceSheet, TableBrief } from '../lib/types'

type Props = {
  tables: TableBrief[]
  reloadTables: () => Promise<void>
}

const STEP_LABELS = ['选文件', '字段映射', '导入']

/** 面板状态：配置 → 运行中 → 已完成 */
type Phase = 'config' | 'running' | 'done'

/**
 * 空白工作表：既没有可识别的列（表头全空），也没有数据行。
 * 这种 sheet 不单独渲染映射块，只在下方汇总提示，避免占满侧栏。
 */
const isBlankSheet = (s: SourceSheet) => s.columns.length === 0 || s.totalDataRows === 0

/**
 * MappingEditor 只会回传它渲染过的（非空白）工作表，
 * 这里按原始顺序把空白表插回去，保证 `parsed.sheets` 始终是完整清单。
 */
function mergeSheets(edited: SourceSheet[], blanks: SourceSheet[]): SourceSheet[] {
  if (blanks.length === 0) return edited
  const blankByName = new Map(blanks.map((s) => [s.name, s]))
  return edited.flatMap((s) => {
    const blank = blankByName.get(s.name)
    blankByName.delete(s.name)
    return blank ? [s, blank] : [s]
  })
}

export default function ImportPanel({ tables, reloadTables }: Props) {
  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [headerRow, setHeaderRow] = useState<number>(1)
  const [skipEmptyRows, setSkipEmptyRows] = useState(true)
  const [uploadBatchSize, setUploadBatchSize] = useState(10)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  /** 仅表示「正在解析文件」，不触发状态页切换 */
  const [parsing, setParsing] = useState(false)
  const [phase, setPhase] = useState<Phase>('config')
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  /** 非致命提示（例如用户取消） */
  const [warn, setWarn] = useState('')
  const [showOptions, setShowOptions] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastFile = useRef<File | null>(null)
  /** 置 true 后导入器在下一个检查点退出（已写入的部分不回滚） */
  const stopRef = useRef(false)
  /**
   * 运行页的秒表。
   * 附件是串行上传的，几十 MB 的文件会让进度停在同一处好几分钟 ——
   * 有秒表用户才能确认「它在动」而不是卡死了。
   */
  const [elapsed, setElapsed] = useState(0)
  const [copiedDiag, setCopiedDiag] = useState(false)

  useEffect(() => {
    if (phase !== 'running') return
    const t0 = Date.now()
    setElapsed(0)
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [phase])

  const pushLog = (s: string) => setLogs((p) => [...p.slice(-300), s])

  const loadFields = useCallback(async (tableId: string) => {
    return await listFields(tableId)
  }, [])

  const handleFile = async (file: File, headerOverride?: number) => {
    lastFile.current = file
    setError('')
    setWarn('')
    setResult(null)
    setLogs([])
    setPhase('config')
    setParsing(true)
    try {
      const res = await parseWorkbookFile(file, { headerRow: headerOverride ?? headerRow })
      setParsed(res)
      pushLog(`已解析「${res.fileName}」：${res.sheets.length} 个工作表`)
      for (const s of res.sheets) {
        const media = s.columns.reduce((n, c) => n + c.mediaCount, 0)
        pushLog(`  · ${s.name}：${s.totalDataRows} 行数据，${s.columns.length} 列，识别到 ${media} 个图片/附件`)
      }
      for (const w of res.warnings) pushLog(`  ! ${w}`)
    } catch (e) {
      setError(`解析失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setParsing(false)
    }
  }

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) void handleFile(f)
    e.target.value = ''
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) void handleFile(f)
  }

  const doImport = async () => {
    if (!parsed) return
    stopRef.current = false
    setCancelling(false)
    setBusy(true)
    setError('')
    setWarn('')
    setLogs([])
    setResult(null)
    setPhase('running')
    try {
      const res = await runImport(liveSheets, {
        skipEmptyRows,
        uploadBatchSize,
        shouldStop: () => stopRef.current,
        onProgress: (p) => {
          setProgress(p)
          if (p.detail && (p.done === 0 || p.done === p.total)) pushLog(`${p.phase} · ${p.detail}`)
        },
      })
      setResult(res)
      await reloadTables()
      if (res.cancelled) {
        pushLog('已取消导入')
        setWarn('已取消导入 —— 剩余内容未写入。已经创建的数据表与写入的记录会保留在表格中。')
        setPhase('config')
      } else {
        pushLog('导入完成')
        setPhase('done')
      }
    } catch (e) {
      setError(`导入失败：${String((e as Error)?.message ?? e)}`)
      pushLog(`! 导入失败：${String((e as Error)?.message ?? e)}`)
      setPhase('config')
    } finally {
      setBusy(false)
      setProgress(null)
      setCancelling(false)
    }
  }

  const totalRows = parsed?.sheets.reduce((n, s) => n + s.totalDataRows, 0) ?? 0
  const totalMedia = parsed?.sheets.reduce((n, s) => n + s.columns.reduce((m, c) => m + c.mediaCount, 0), 0) ?? 0

  /** 空白工作表：不单独渲染映射块，只在下方汇总提示 */
  const blankSheets = parsed?.sheets.filter(isBlankSheet) ?? []
  /** 真正参与映射的工作表 */
  const liveSheets = parsed?.sheets.filter((s) => !isBlankSheet(s)) ?? []
  const enabledCols = liveSheets.reduce((n, s) => n + s.columns.filter((c) => c.enabled).length, 0)
  const liveTableCount = liveSheets.filter((s) => s.columns.some((c) => c.enabled)).length

  /**
   * 运行页的阶段清单。
   * 顺序与 importer 的实际执行顺序一致 —— 附件上传发生在建表之前，
   * 因为记录里的附件字段要写上传后拿到的 token。
   * 没有附件时不插入该阶段，免得出现一条永远不动的空转项。
   */
  const runStages = useMemo(() => {
    const list = [{ key: 'parse', label: '解析工作表与表头' }]
    if (totalMedia > 0) list.push({ key: 'media', label: '上传附件图片' })
    list.push({ key: 'fields', label: '创建数据表与字段' }, { key: 'records', label: '写入记录' })
    return list
  }, [totalMedia])

  /** 附件总体积 —— 直接决定上传要花多久，提前告诉用户，避免误以为卡死 */
  const totalMediaBytes = liveSheets.reduce(
    (n, s) =>
      n +
      [...s.mediaByCell.values()].reduce(
        (m, files) => m + files.reduce((k, f) => k + (f.size || 0), 0),
        0,
      ),
    0,
  )

  /** 把当前状态 + 日志拼成一段可粘贴的诊断文本（卡住时用来反馈） */
  const copyDiagnostics = async () => {
    const text = [
      'BTNExcel 桥 · 导入诊断',
      `版本：${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'}`,
      `文件：${parsed?.fileName ?? '—'}`,
      `附件：${totalMedia} 个，合计 ${formatBytes(totalMediaBytes)}`,
      `已用时：${formatDuration(elapsed)}`,
      `当前阶段：${progress?.phase ?? '—'}`,
      `进度：${progress?.done ?? 0} / ${progress?.total ?? 0}`,
      progress?.detail ? `正在处理：${progress.detail}` : '',
      '',
      '—— 日志 ——',
      ...logs,
    ]
      .filter((l) => l !== '')
      .join('\n')
    const okCopy = await copyText(text)
    setCopiedDiag(okCopy)
    window.setTimeout(() => setCopiedDiag(false), 1800)
  }

  /** 回到配置态，方便连续导入多份文件 */
  const resetImport = () => {
    setParsed(null)
    setResult(null)
    setError('')
    setLogs([])
    setProgress(null)
    setPhase('config')
    lastFile.current = null
  }

  /* ==================== 运行中：整页只留进度 ==================== */
  if (phase === 'running') {
    return (
      <div className="run-page">
        <Steps items={STEP_LABELS} current={2} />
        <RingProgress
          tone="import"
          done={progress?.done ?? 0}
          total={progress?.total ?? 0}
          label={progress?.phase ?? '正在准备'}
          detail={progress?.detail}
          ringCaption="已写入"
          stages={runStages}
          currentStage={progress?.stage}
        />
        <div className="footer-bar">
          <span className="muted">导入中 · 已用时 {formatDuration(elapsed)}</span>
          <span className="footer-actions">
            <button className="btn ghost xs" onClick={() => void copyDiagnostics()}>
              {copiedDiag ? '已复制' : '复制日志'}
            </button>
            <button
              className="btn ghost xs"
              disabled={cancelling}
              onClick={() => {
                stopRef.current = true
                setCancelling(true)
              }}
            >
              {cancelling ? '正在停止…' : '取消'}
            </button>
          </span>
        </div>
      </div>
    )
  }

  /* ==================== 已完成：整页只留结果 ==================== */
  if (phase === 'done' && result) {
    return (
      <div className="done-page">
        <CompletionCard
          title="导入完成"
          subtitle={
            result.tables.length > 0
              ? `「${result.tables[0].tableName}」${
                  result.tables.length > 1 ? ` 等 ${result.tables.length} 张表` : ''
                } 已写入当前多维表格`
              : '没有写入任何数据表，请检查下方提示'
          }
          stats={[
            { v: liveTableCount, k: '数据表' },
            { v: enabledCols, k: '字段' },
            { v: totalRows, k: '行记录' },
            { v: totalMedia, k: '附件图片' },
          ]}
          actions={
            <>
              <button className="btn ghost" onClick={() => setPhase('config')}>
                返回
              </button>
              <button className="btn primary" onClick={resetImport}>
                <IconRetry size={14} />
                再导入一个
              </button>
            </>
          }
          note="同名数据表已自动加序号，可在左侧数据表列表查看"
        >
          {result.tables.length > 0 && (
            <div className="result-list" style={{ marginTop: 16 }}>
              {result.tables.map((t, i) => (
                <div className="result-item" key={i}>
                  <span className="result-name" title={`${t.sheet} → ${t.tableName}`}>
                    {t.tableName}
                  </span>
                  <span className="muted">新建 {t.createdFields} 字段</span>
                  <span className="muted">复用 {t.reusedFields}</span>
                  <span className="badge ok">{t.records} 条</span>
                </div>
              ))}
            </div>
          )}

          {result.warnings.map((w, i) => (
            <Notice kind="warn" key={`w${i}`}>
              {w}
            </Notice>
          ))}

          {result.errors.length > 0 && (
            <>
              <div className="log-title">跳过的内容（{result.errors.length} 条，最多显示 100 条）</div>
              <div className="log">
                {result.errors
                  .slice(0, 100)
                  .map((e) => `${e.sheet}${e.row > 0 ? ` 第${e.row}行` : ''} · ${e.column} → ${e.message}`)
                  .join('\n')}
              </div>
            </>
          )}

          {/* 附件耗时排行 —— 进度长时间不动时，一眼看出是哪张图在拖 */}
          {result.uploadTimings && result.uploadTimings.length > 0 && (
            <>
              <div className="log-title" style={{ color: 'var(--text-3)' }}>
                附件上传耗时（最慢 20 个 / 共 {result.uploadTimings.length} 个）
              </div>
              <div className="log">
                {result.uploadTimings
                  .filter((t) => t.ok)
                  .sort((a, b) => b.ms - a.ms)
                  .slice(0, 20)
                  .map((t) => `${(t.ms / 1000).toFixed(1)}s\t${formatBytes(t.size)}\t${t.name}`)
                  .join('\n')}
              </div>
            </>
          )}

          {logs.length > 0 && (
            <>
              <div className="log-title" style={{ color: 'var(--text-3)' }}>
                执行日志
              </div>
              <div className="log">{logs.join('\n')}</div>
            </>
          )}
        </CompletionCard>
      </div>
    )
  }

  /* ==================== 配置态 ==================== */
  return (
    <>
      <Steps items={STEP_LABELS} current={parsed ? 1 : 0} />

      <Card flush>
        {/* 未选文件时：hero 空态（给侧栏一个明确的「从这里开始」） */}
        {!parsed && (
          <div className="hero">
            <div className="hero-art">
              <IconSheetImage size={34} />
            </div>
            <h2>把 Excel 搬进多维表格</h2>
            <p>
              图片列自动转成「附件」字段
              <br />
              表头、多选、多工作表原样保留
            </p>
          </div>
        )}

        <div className="card-pad">
          <input
            ref={inputRef}
            type="file"
            accept={IMPORT_ACCEPT}
            style={{ display: 'none' }}
            onChange={onPick}
          />
          <div
            className={`dropzone${over ? ' over' : ''}${parsed ? ' compact' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            <span className="dz-icon">
              <IconUpload size={parsed ? 17 : 20} />
            </span>
            <span className="dz-main">{parsed ? parsed.fileName : '拖入表格文件，或点击选择'}</span>
            <span className="dz-sub">
              {parsed
                ? `${liveSheets.length} 个工作表${
                    blankSheets.length > 0 ? `（跳过 ${blankSheets.length} 个空白）` : ''
                  } · ${totalRows} 行 · 识别附件 ${totalMedia} 个 · 点击可换文件`
                : '支持一次拖入一个文件 · 图片列会自动转成「附件」字段'}
            </span>
          </div>

          {/* 支持的文件类型一览 —— 说明收进末尾的 ? 图标，鼠标移上去才展开 */}
          {!parsed && (
            <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
              {IMPORTABLE_FILE_TYPES.map((t) => (
                <Tip key={t.ext} text={`${t.label}（.${t.ext}）— ${t.note}`}>
                  <span className={`ftype${t.zip ? ' rich' : ''}`}>.{t.ext}</span>
                </Tip>
              ))}
              <Tip
                text={
                  <>
                    <b>.xlsx / .xlsm / .xltx / .xltm / .xlam</b> 是 zip 容器，里面的图片能被解析成「附件」字段。
                    <br />
                    其余格式（<b>.xls / .xlsb / .ods / .csv / .txt</b>）只能读取单元格文本，
                    图片列会是空的 —— 需要图片请先用 WPS / Excel 另存为 .xlsx。
                  </>
                }
              >
                <span className="ftype-info" aria-label="支持的文件类型说明">
                  <IconInfo size={12} />
                </span>
              </Tip>
            </div>
          )}

          <div className="row wrap" style={{ marginTop: 12 }}>
            <label className="check">
              <span>表头在第</span>
              <input
                className="input size-input"
                inputMode="numeric"
                value={headerRow}
                onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1))}
              />
              <span className="muted">行</span>
            </label>
            <button
              className="btn ghost xs"
              disabled={!lastFile.current || busy}
              onClick={() => lastFile.current && void handleFile(lastFile.current, headerRow)}
            >
              重新解析
            </button>
            <button className="btn ghost xs" style={{ marginLeft: 'auto' }} onClick={() => setShowOptions((v) => !v)}>
              {showOptions ? '收起导入选项' : '导入选项'}
            </button>
          </div>

          {showOptions && (
            <div className="opt-panel">
              <label className="check">
                <input type="checkbox" checked={skipEmptyRows} onChange={(e) => setSkipEmptyRows(e.target.checked)} />
                <span>跳过整行空白的数据行</span>
              </label>
              <label className="check">
                <span>附件每批上传</span>
                <input
                  className="input size-input"
                  inputMode="numeric"
                  value={uploadBatchSize}
                  onChange={(e) =>
                    setUploadBatchSize(Math.min(50, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 10)))
                  }
                />
                <span className="muted">个</span>
                <Tip
                  text={
                    <>
                      多维表格的上传接口 <b>禁止并发调用</b>，这里会按批次串行上传。
                      <br />
                      批次越大，往返次数越少、总耗时越短；但单批一旦失败要走逐个兜底，代价也更高。
                      <br />
                      附件很多（几百个）时建议调到 <b>20–30</b>。
                    </>
                  }
                >
                  <span className="help-dot">
                    <IconInfo size={12} />
                  </span>
                </Tip>
              </label>
            </div>
          )}
        </div>
      </Card>

      {error && <Notice kind="err">{error}</Notice>}
      {warn && <Notice kind="warn">{warn}</Notice>}

      {parsed && parsed.sheets.length > 0 && (
        <>
          {liveSheets.length > 0 && (
            <Card
              title="字段映射"
              hint="每个工作表单独成表；取消勾选 = 不导入该字段；类型可改"
              extra={
                <span className="badge subtle">
                  <IconTable size={11} />
                  {liveTableCount} 表 / {enabledCols} 字段
                </span>
              }
            >
              <MappingEditor
                sheets={liveSheets}
                tables={tables}
                onLoadFields={loadFields}
                onChange={(sheets: SourceSheet[]) => setParsed({ ...parsed, sheets: mergeSheets(sheets, blankSheets) })}
              />
              {totalMedia > 0 && (
                <Notice>
                  <IconImage size={13} /> 识别到 <b>{totalMedia}</b> 个图片/附件
                  {totalMediaBytes > 0 ? `（合计 ${formatBytes(totalMediaBytes)}）` : ''}，已默认放进「附件」字段。
                  附件只能 <b>串行上传</b>，体积越大耗时越长 —— 几百个附件通常要几分钟到十几分钟；
                  进度长时间停在同一处时，多半是某个大文件正在传，可以点「复制日志」查看正在传哪个。
                </Notice>
              )}
              <Notice kind="warn">
                导入会真实写入当前多维表格。同名数据表会自动加序号；同名已有字段会复用而不是重复新建。
              </Notice>
            </Card>
          )}

          {/* 空白工作表：不单独占一个映射块，只在下方汇总提示 */}
          {blankSheets.length > 0 && (
            <Notice kind="warn">
              已跳过 <b>{blankSheets.length}</b> 个空白工作表：
              {blankSheets.map((s) => (
                <code key={s.name} className="sheet-skip-tag">
                  {s.name}
                </code>
              ))}
              —— 这些工作表没有表头也没有数据行，不会导入。
            </Notice>
          )}
        </>
      )}

      {parsed && liveSheets.length > 0 && (
        <div className="footer-bar">
          <span className="muted">
            将导入 {liveTableCount} 张数据表 · {enabledCols} 个字段 · {totalRows} 行数据
          </span>
          <button className="btn primary" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => void doImport()}>
            <IconUpload size={14} />
            {busy ? '处理中…' : '开始导入'}
          </button>
        </div>
      )}
    </>
  )
}
