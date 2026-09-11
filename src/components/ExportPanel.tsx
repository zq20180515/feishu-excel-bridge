import { useState } from 'react'
import { Card, CompletionCard, Notice, RingProgress, Segmented, Tip } from './ui'
import {
  IconDownload,
  IconFolder,
  IconImage,
  IconInfo,
  IconRefresh,
  IconTable,
} from './icons'
import { revealExportFile, runExport, triggerDownload } from '../lib/exporter'
import type { ExportProgress, ExportResult } from '../lib/exporter'
import type { TableBrief } from '../lib/types'

type Props = {
  tables: TableBrief[]
  reloadTables: () => Promise<void>
}

type ImageMode = 'dispimg' | 'float'
/** 打包方式：一个 Excel 还是按表拆成多个（zip） */
type PackMode = 'single' | 'perTable'
/** 面板状态：配置 → 运行中 → 已完成 */
type Phase = 'config' | 'running' | 'done'

const MODE_TIP: Record<ImageMode, string> = {
  dispimg:
    '图片作为「嵌入单元格图片」写进文件：图片真正住在单元格里，随行高列宽一起显示，筛选/排序不会错位。需要 WPS 打开才能看到图片；原生 Excel 会显示为 =DISPIMG(...) 公式。',
  float:
    '图片作为标准浮动图片锚定在单元格上：Excel / WPS / LibreOffice 都能正常显示，兼容性最好。图片会覆盖在单元格上方，删除整行时需要留意图片位置。',
}

const PACK_TIP: Record<PackMode, string> = {
  single:
    '所有选中的数据表写进同一个 Excel，每张数据表对应一个工作表（Sheet）。适合汇总归档。',
  perTable:
    '每张数据表单独生成一个 Excel 文件，整体打包成 zip 下载。适合按表分发；只有一张表时会直接给 xlsx。',
}

/** 阶段清单（与 exporter.ts 的 ExportStage 对应） */
const EXPORT_STAGES = [
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
  const [attachmentNameColumn, setAttachmentNameColumn] = useState(true)
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
          stages={EXPORT_STAGES}
          currentStage={progress?.stage}
        />
        <div className="footer-bar">
          <span className="muted">导出进行中，大文件可能需要几分钟</span>
        </div>
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
              { value: 'single', label: '合并为一个 Excel', tip: PACK_TIP.single },
              { value: 'perTable', label: '拆分多个 Excel', tip: PACK_TIP.perTable },
            ]}
            onChange={setPackMode}
          />
        </div>

        <div className="opt-group">
          <div className="opt-label">图片嵌入方式</div>
          <Segmented<ImageMode>
            value={imageMode}
            ariaLabel="图片嵌入方式"
            options={[
              { value: 'dispimg', label: 'WPS嵌入单元格图片', icon: <IconImage size={14} />, tip: MODE_TIP.dispimg },
              { value: 'float', label: '标准浮动图片', icon: <IconImage size={14} />, tip: MODE_TIP.float },
            ]}
            onChange={setImageMode}
          />
        </div>

        {/* 图片尺寸 —— 两种嵌图方式都生效 */}
        <div className="opt-row sub">
          <label className="check">
            <span>图片边长</span>
            <input
              className="input size-input"
              inputMode="numeric"
              placeholder="原图"
              value={imageSize}
              onChange={(e) => setImageSize(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
            <span className="muted">px</span>
            <Tip text="留空 = 按原图原尺寸导出（推荐）。填入数字 = 等比缩放到该边长，可让表格更紧凑。两种嵌图方式都生效。">
              <span className="help-dot">
                <IconInfo size={12} />
              </span>
            </Tip>
          </label>
          <span className="muted">
            {parsedSize > 0 ? `等比缩放，最长边 ${Math.min(2000, parsedSize)}px` : '原图原尺寸导出'}
          </span>
        </div>

        {/* 多图处理 */}
        <div className="opt-row sub">
          <label className="check">
            <input
              type="checkbox"
              checked={allImages}
              onChange={(e) => setAllImages(e.target.checked)}
            />
            <span>
              全部图片都导出
              <Tip text="开启后，附件字段里的每张图片单独占一个单元格：字段名「照片」时，第 1 张在「照片」列、第 2 张在「照片2」列、第 3 张在「照片3」列……（单个字段最多 10 张）">
                <span className="help-dot">
                  <IconInfo size={12} />
                </span>
              </Tip>
            </span>
          </label>
          <span className="muted">
            {allImages ? '多图分列：照片 / 照片2 / 照片3…' : '单个单元格只嵌第一张图'}
          </span>
        </div>

        {/* 其它开关 */}
        <div className="opt-row sub">
          <label className="check">
            <input
              type="checkbox"
              checked={attachmentNameColumn}
              onChange={(e) => setAttachmentNameColumn(e.target.checked)}
            />
            <span>
              额外输出「附件名」列
              <Tip
                text={
                  allImages
                    ? '在附件列右侧再插一列纯文本文件名，方便核对每个单元格里的图片叫什么（第 11 张之后的图片只在「附件名」列里列出）。'
                    : '在附件列右侧再插一列纯文本文件名，方便核对哪些附件没被嵌入（一个单元格只嵌第一张图）。'
                }
              >
                <span className="help-dot">
                  <IconInfo size={12} />
                </span>
              </Tip>
            </span>
          </label>
          <label className="check">
            <span>跳过超过</span>
            <input
              className="input size-input"
              inputMode="numeric"
              value={maxImageMb}
              onChange={(e) => setMaxImageMb(Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 10))}
            />
            <span className="muted">MB 的附件</span>
          </label>
        </div>

        {imageMode === 'dispimg' && (
          <Notice>
            DISPIMG 是 <b>WPS 的专有扩展</b>：用 WPS 打开可以看到图片在单元格里；用原生 Excel 打开时该单元格显示为
            <code>=DISPIMG(...)</code> 公式，图片仍保留在文件中。需要在 Excel 里也能看到图片，请改用「标准浮动图片」。
          </Notice>
        )}
        <Notice>
          {allImages
            ? '「全部图片都导出」已开启：附件字段里的每张图会各占一列（照片、照片2、照片3…），第 11 张起不再展开。'
            : '单个单元格只嵌第一张图，其余附件名见「附件名」列。需要把多余的图片也铺开，请勾选上面的「全部图片都导出」。'}
        </Notice>
        {selected.size > 1 && (
          <Notice kind="warn">
            {packMode === 'single'
              ? '多表导出时图片统一放在同一个 xlsx 内，每个工作表各自展开自己的图片列。'
              : `将按数据表拆成 ${selected.size} 个 Excel 文件，整体打包成 zip 下载。`}
          </Notice>
        )}
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
