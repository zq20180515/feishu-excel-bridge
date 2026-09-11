import JSZip from 'jszip'
import { FT, isImageMime } from './field-meta'
import { fetchAllRecords, getAttachmentUrls, getTable, orderedFields, withTimeout } from './base-api'
import { bitableValueToExcel, extractAttachments, guessExtFromMime } from './value-convert'
import { buildXlsxBlob } from './excel-write'
import type { OutCellImage, OutImage, OutSheet } from './excel-write'
import type { FieldBrief, StageItem } from './types'

/** 导出的四个阶段，供 UI 渲染阶段清单 */
export type ExportStage = 'read' | 'fetch' | 'media' | 'pack'

export type ExportProgress = {
  phase: string
  done: number
  total: number
  detail?: string
  /** 当前处于哪个阶段（用于打勾清单） */
  stage?: ExportStage
  /** 当前阶段的明细（下载阶段是每张图的状态，可展开查看） */
  items?: StageItem[]
}

/**
 * 打包方式。
 * - `single`：所有选中的数据表放进同一个 Excel（每表一个工作表）
 * - `perTable`：每张数据表单独一个 Excel，整体打包成 zip 下载
 */
export type ExportPackMode = 'single' | 'perTable'

/** 一个下载失败的附件（可逐张重试） */
export type MediaFailure = {
  id: string
  name: string
  /** 字节数 */
  size: number
  reason: string
  tableName: string
}

/**
 * 图片下载阶段的中间态。
 * 交给界面决定「逐张重试」还是「跳过继续」—— 下载全部成功时不会走到这里。
 */
export type ExportMediaSession = {
  failures: MediaFailure[]
  /** 重试指定失败项（不传 = 全部失败项）；返回重试后**仍然失败**的项 */
  retry: (ids?: string[]) => Promise<MediaFailure[]>
}

export type ExportOptions = {
  tableIds: string[]
  /** dispimg = WPS 内嵌单元格；float = 浮动图片锚定到单元格 */
  imageMode: 'dispimg' | 'float'
  /**
   * 是否把附件里的图片嵌进单元格。
   * UI 上已不再暴露开关（「图片嵌入方式」本身已表达该意图），保留参数是为了
   * 保持导出器的可测性与将来可能的批量场景。
   */
  embedImages: boolean
  /** 打包方式：一个 Excel 还是拆成多个 */
  packMode: ExportPackMode
  /**
   * 全部图片都导出。
   *
   * false（默认）：一个附件字段只嵌第一张图，其余图片的文件名走「附件名」列。
   * true：附件字段里的每一张图片都单独占一个单元格 ——
   *       字段名「照片」时，第 1 张在「照片」列、第 2 张在「照片2」列、第 3 张在「照片3」列……
   */
  allImages: boolean
  /** 在附件列右侧额外输出一列附件文件名（多值换行） */
  attachmentNameColumn: boolean
  /**
   * 图片显示边长（px）。不传或 0 = 原图原尺寸。
   * 两种嵌图模式都生效：dispimg 写进 cellimages 的 a:ext，float 写进锚点尺寸。
   */
  imageSizePx?: number
  /** 超过该大小的附件不下载（MB） */
  maxImageMb: number
  /**
   * 图片下载完成后、打包生成 Excel 之前调用。
   *
   * 有失败项时界面可以在这里让用户**逐张重试**或**跳过**；
   * 返回 `'abort'` 表示放弃本次导出（不生成文件）。
   * 全部成功时不会调用这个钩子。
   */
  onMediaReady?: (session: ExportMediaSession) => Promise<'continue' | 'abort'>
  onProgress?: (p: ExportProgress) => void
}

export type ExportResult = {
  blob: Blob
  fileName: string
  summary: { table: string; records: number; images: number }[]
  warnings: string[]
  errors: string[]
  /** 实际产出的文件数：single = 1，perTable = 数据表数量（打包成 zip） */
  fileCount: number
}

type Column =
  | { kind: 'field'; field: FieldBrief }
  /** 附件字段的第 slot 张图（slot 从 0 起）；多图模式下每个 slot 是一列 */
  | { kind: 'attachment'; field: FieldBrief; slot: number }
  | { kind: 'attachmentNames'; field: FieldBrief }

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    for (;;) {
      const idx = cursor++
      if (idx >= items.length) return
      out[idx] = await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * 单个附件下载的超时（毫秒）。
 *
 * ⚠️ 这个值刻意压得比较小。实测数据里最大的图只有 868 KB、最慢 0.6 秒 ——
 * 正常单张下载是**亚秒级**。某个请求一旦远超这个量级，它通常是卡在连接上
 * 而不是在传数据，久等毫无意义，反而会把并发槽位占住、拖慢整批。
 * 失败后会立刻进「待确认」页，点一下就能重试，所以宁可早点放弃。
 */
const IMAGE_FETCH_TIMEOUT_MS = 45_000
/** 取下载地址（SDK 调用）的超时，同样不能久等 */
const GET_URL_TIMEOUT_MS = 30_000

/** 人类可读的体积 */
function fmtSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const mb = bytes / 1024 / 1024
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** 构造超时信号；老环境不支持 AbortSignal.timeout 时降级为不超时 */
function timeoutSignal(ms: number): AbortSignal | undefined {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms)
    }
  } catch {
    /* 忽略 */
  }
  return undefined
}

function safeFileStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

function downloadName(name: string, ext: string): string {
  const base = (name || 'image').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120)
  if (/\.[A-Za-z0-9]{2,5}$/.test(base)) return base
  return `${base}.${ext}`
}

export async function runExport(opts: ExportOptions): Promise<ExportResult> {
  const warnings: string[] = []
  const errors: string[] = []
  const summary: ExportResult['summary'] = []
  const outSheets: OutSheet[] = []
  const report = (
    stage: ExportStage,
    phase: string,
    done: number,
    total: number,
    detail?: string,
    items?: StageItem[],
  ) => opts.onProgress?.({ stage, phase, done, total, detail, items })

  /**
   * 待下载的附件任务。
   * 保留 `table` / `recordId` / `fieldId` 是为了**下载失败后能逐张重试** ——
   * 重试要重新调 `getCellAttachmentUrls` 取新的临时链接。
   */
  type ImgTask = {
    /** 全局唯一（`表序::表内序号`），便于界面按 id 重试 */
    id: string
    row: number
    col: number
    token: string
    name: string
    size: number
    type: string
    recordId: string
    fieldId: string
    table: unknown
    tableName: string
    /** 在所属表的 imgTasks 里的下标，用于回填明细状态 */
    idx: number
    /** 所属表的图片收集数组 —— 重试成功时往这里补，避免跨表串味 */
    sink: OutCellImage[]
  }

  /** 下载失败的附件，交给界面决定重试或跳过 */
  const failedTasks: ImgTask[] = []
  /** 失败项在明细列表里的条目，重试成功后要把状态改回来 */
  const itemsByTaskId = new Map<string, StageItem>()
  const failureReason = new Map<string, string>()

  const tableIds = opts.tableIds.filter(Boolean)
  if (!tableIds.length) throw new Error('请至少选择一个数据表')

  let totalImages = 0
  let downloadFailures = 0
  /** 用于检出「超过 10 列上限」的字段名 */
  const maxSlotsPeek = new Map<string, number>()

  for (let ti = 0; ti < tableIds.length; ti++) {
    const tableId = tableIds[ti]
    const table = await getTable(tableId)
    let tableName = `数据表${ti + 1}`
    try {
      tableName = (await table.getName()) || tableName
    } catch {
      /* ignore */
    }
    report('read', `读取 ${ti + 1}/${tableIds.length}`, ti, tableIds.length, tableName)

    const fields = await orderedFields(table)
    const records = await fetchAllRecords(table)
    report('fetch', `读取 ${ti + 1}/${tableIds.length}`, 0, records.length, `${tableName} · 拉取字段与记录`)

    /**
     * 组装列。
     *
     * 单图模式：附件字段占一列（只嵌第一张），可选再跟一列「(附件名)」。
     * 多图模式：先扫一遍所有记录，算出每个附件字段最多有几十张图（上限 10 列），
     *          然后为第 1..N 张各占一列（照片 / 照片2 / 照片3 …）。
     */
    const maxSlotsByField = new Map<string, number>()
    if (opts.embedImages && opts.allImages) {
      for (const rec of records) {
        const vals = ((rec as Record<string, unknown>)?.fields ?? {}) as Record<string, unknown>
        for (const f of fields) {
          if (f.type !== FT.Attachment) continue
          const n = extractAttachments(vals[f.id]).length
          if (n > (maxSlotsByField.get(f.id) ?? 0)) maxSlotsByField.set(f.id, n)
        }
      }
    }

    const columns: Column[] = []
    for (const f of fields) {
      if (f.type === FT.Attachment) {
        const rawMax = opts.embedImages && opts.allImages ? maxSlotsByField.get(f.id) ?? 0 : 0
        if (rawMax > 0) maxSlotsPeek.set(`${tableName} · ${f.name}`, rawMax)
        const slots = Math.min(10, rawMax)
        // 一张图都没有时也要保留一列，否则表头会莫名少一列
        for (let s = 0; s < Math.max(1, slots); s++) columns.push({ kind: 'attachment', field: f, slot: s })
        if (opts.attachmentNameColumn) columns.push({ kind: 'attachmentNames', field: f })
      } else {
        columns.push({ kind: 'field', field: f })
      }
    }

    report('fetch', `读取 ${ti + 1}/${tableIds.length}`, 0, records.length, `${tableName} · 整理数据`)

    // 先建 rows + 收集需要下载的附件
    const rows: (string | number | boolean | null)[][] = []
    const imgTasks: ImgTask[] = []
    /** 本表要嵌进单元格的图片（提前声明，任务里要引用它以便重试时回填） */
    const cellImages: OutCellImage[] = []

    for (let ri = 0; ri < records.length; ri++) {
      const rec = records[ri] as Record<string, unknown>
      const vals = (rec?.fields ?? {}) as Record<string, unknown>
      const recordId = String(rec?.recordId ?? rec?.id ?? '')
      const row: (string | number | boolean | null)[] = []
      const namesByField = new Map<string, string[]>()

      columns.forEach((col, ci) => {
        const raw = vals[col.field.id]
        if (col.kind === 'attachment') {
          const atts = extractAttachments(raw)
          const names = atts.map((a) => a.name)
          namesByField.set(col.field.id, names)
          if (!opts.embedImages) {
            // 不嵌图时只在第一列输出文件名，后续 slot 列留空
            row.push(col.slot === 0 ? names.join('\n') : null)
            return
          }
          // 多图模式：本列对应第 slot 张；单图模式：只看第 0 张
          const a = atts[col.slot]
          if (!a) {
            row.push(null)
            return
          }
          if (!isImageMime(a.type) || (a.size && a.size / 1024 / 1024 > opts.maxImageMb)) {
            // 非图片 / 超限：降级成文件名，至少信息不丢
            row.push(a.name)
            return
          }
          row.push(null)
          imgTasks.push({
            id: `${ti}::${imgTasks.length}`,
            idx: imgTasks.length,
            row: ri + 1,
            col: ci,
            token: a.token,
            name: a.name,
            size: a.size,
            type: a.type,
            recordId,
            fieldId: col.field.id,
            table,
            tableName,
            sink: cellImages,
          })
        } else if (col.kind === 'attachmentNames') {
          row.push((namesByField.get(col.field.id) ?? []).join('\n'))
        } else {
          row.push(bitableValueToExcel(col.field.type, raw))
        }
      })
      rows.push(row)

      if (ri % 50 === 0)
        report('fetch', `读取 ${ti + 1}/${tableIds.length}`, ri, records.length, `${tableName} · 整理数据 ${ri + 1}/${records.length}`)
    }

    // 下载图片：先拿临时下载地址，再取二进制
    if (imgTasks.length) {
      /** 每张图一条明细，界面展开后可看到具体下载到哪一张 */
      const imgItems: StageItem[] = imgTasks.map((t) => ({
        label: t.name,
        meta: fmtSize(t.size || 0),
        state: 'pending',
      }))

      // 按 (recordId, fieldId) 分组，一次拿一组 URL
      const groups = new Map<string, ImgTask[]>()
      for (const t of imgTasks) {
        const k = `${t.recordId}\u0000${t.fieldId}`
        const list = groups.get(k) ?? []
        list.push(t)
        groups.set(k, list)
      }
      const groupList = [...groups.entries()]

      report('media', '下载附件图片', 0, imgTasks.length, `${tableName}`, imgItems)

      let done = 0
      /*
       * 并发度刻意保守：3 个单元格组 × 每组 2 张 = 最多 6 个并发请求。
       *
       * 之前是 4 × 3 = 12，配上 120 秒的单张超时，一旦有连接卡住，
       * 并发槽会被占满两分钟，整批就像「死住不动」——
       * 这正是「下载时突然卡在某张一百多 K 的图上一动不动」的来源。
       * 图片本身很小（实测最大 868 KB / 0.6 秒），并发开大并不能更快，
       * 反而更容易触发服务端限流。
       */
      await mapPool(groupList, 3, async ([, tasksInGroup]) => {
        const first = tasksInGroup[0]
        let urls: string[] = []
        try {
          urls = await withTimeout(
            getAttachmentUrls(
              table,
              tasksInGroup.map((t) => t.token),
              first.fieldId,
              first.recordId,
            ),
            GET_URL_TIMEOUT_MS,
            '获取附件下载地址',
          )
        } catch {
          urls = []
        }

        await mapPool(tasksInGroup, 2, async (task, k) => {
          const item = imgItems[task.idx]
          const url = urls[k]

          /** 记一次失败：同时落到明细状态、重试队列和最终报告里 */
          const markFail = (reason: string) => {
            downloadFailures++
            if (item) {
              item.state = 'fail'
              item.meta = `${fmtSize(task.size || 0)} · ${reason}`
              itemsByTaskId.set(task.id, item)
            }
            failureReason.set(task.id, reason)
            failedTasks.push(task)
            errors.push(`附件「${task.name}」下载失败：${reason}`)
          }

          if (!url) {
            markFail('未取到下载地址')
          } else {
            /*
             * 失败重试一次。
             * 临时链接刚生成就失效、或网络抖动都很常见，重试往往就过了 ——
             * 用户拿到「有 N 张没导出成功」却不知道是哪几张，体验很差。
             */
            let ok = false
            for (let attempt = 0; attempt < 2 && !ok; attempt++) {
              try {
                const res = await fetch(url, { signal: timeoutSignal(IMAGE_FETCH_TIMEOUT_MS) })
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                const buf = await res.arrayBuffer()
                const mime = res.headers.get('content-type') || task.type
                const ext = guessExtFromMime(mime, task.name)
                cellImages.push({
                  row: task.row,
                  col: task.col,
                  img: { name: downloadName(task.name, ext), ext, bytes: new Uint8Array(buf) },
                })
                totalImages++
                ok = true
                if (item) {
                  item.state = 'done'
                  item.meta = fmtSize(task.size || 0)
                }
              } catch (e) {
                if (attempt === 0) continue
                markFail(String((e as Error)?.message ?? e))
              }
            }
          }

          done++
          if (done % 5 === 0 || done === imgTasks.length) {
            report(
              'media',
              '下载附件图片',
              done,
              imgTasks.length,
              `${tableName} · 第 ${done} / ${imgTasks.length} 张`,
              imgItems,
            )
          }
        })
      })
    }

    outSheets.push({
      name: tableName,
      headers: columns.map((c) => {
        if (c.kind === 'attachmentNames') return `${c.field.name}(附件名)`
        // 多图模式：第 1 张沿用原名，第 2 张起叫「照片2」「照片3」……
        if (c.kind === 'attachment' && c.slot > 0) return `${c.field.name}${c.slot + 1}`
        return c.field.name
      }),
      rows,
      images: cellImages,
    })

    summary.push({ table: tableName, records: records.length, images: cellImages.length })
  }

  /* ---------- 下载完成：有失败项就交给界面决定「重试 / 跳过」 ---------- */
  if (failedTasks.length > 0 && opts.onMediaReady) {
    /**
     * 逐张重试。
     * 首次下载是「按单元格批量」，重试改成一张一张来 ——
     * 失败项通常只有几张，逐个更好定位，也避免一整批因一张失败而白跑。
     */
    const retry = async (ids?: string[]): Promise<MediaFailure[]> => {
      const targets = ids?.length
        ? failedTasks.filter((t) => ids.includes(t.id))
        : [...failedTasks]
      const stillFailed: MediaFailure[] = []

      for (const task of targets) {
        let reason = ''
        try {
          const urls = await withTimeout(
            getAttachmentUrls(task.table as never, [task.token], task.fieldId, task.recordId),
            GET_URL_TIMEOUT_MS,
            '获取附件下载地址',
          )
          const url = urls?.[0]
          if (!url) throw new Error('未取到下载地址')
          const res = await fetch(url, { signal: timeoutSignal(IMAGE_FETCH_TIMEOUT_MS) })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const buf = await res.arrayBuffer()
          const mime = res.headers.get('content-type') || task.type
          const ext = guessExtFromMime(mime, task.name)
          task.sink.push({
            row: task.row,
            col: task.col,
            img: { name: downloadName(task.name, ext), ext, bytes: new Uint8Array(buf) },
          })
          totalImages++
          // 重试成功 → 把先前记下的失败撤掉，否则最终报告还会说它失败
          downloadFailures = Math.max(0, downloadFailures - 1)
          const item = itemsByTaskId.get(task.id)
          if (item) {
            item.state = 'done'
            item.meta = fmtSize(task.size || 0)
          }
          const at = failedTasks.indexOf(task)
          if (at >= 0) failedTasks.splice(at, 1)
          const errAt = errors.findIndex((e) => e.includes(`附件「${task.name}」下载失败`))
          if (errAt >= 0) errors.splice(errAt, 1)
        } catch (e) {
          reason = String((e as Error)?.message ?? e)
          const item = itemsByTaskId.get(task.id)
          if (item) item.meta = `${fmtSize(task.size || 0)} · ${reason}`
        }
        if (reason) {
          stillFailed.push({
            id: task.id,
            name: task.name,
            size: task.size,
            reason,
            tableName: task.tableName,
          })
        }
      }
      return stillFailed
    }

    const decision = await opts.onMediaReady({
      failures: failedTasks.map((t) => ({
        id: t.id,
        name: t.name,
        size: t.size,
        reason: failureReason.get(t.id) ?? '下载失败',
        tableName: t.tableName,
      })),
      retry,
    })
    if (decision === 'abort') throw new Error('已取消导出')
  }

  if (opts.embedImages && opts.allImages) {
    const capped = [...maxSlotsPeek.entries()].filter(([, n]) => n > 10)
    for (const [name, n] of capped) {
      warnings.push(`附件字段「${name}」单个单元格最多有 ${n} 张图，已只导出前 10 张（照片、照片2 … 照片10）。`)
    }
  }

  if (downloadFailures > 0) {
    // 把失败的文件名带出来 —— 只说「有 N 张失败」用户根本不知道该去补哪几张
    const failedNames = [...new Set(
      errors
        .map((e) => e.match(/附件「(.+?)」/)?.[1] ?? '')
        .filter(Boolean),
    )]
    warnings.push(
      `有 ${downloadFailures} 个附件未能下载（已自动重试 1 次）。` +
        (failedNames.length > 0
          ? `具体是：${failedNames.slice(0, 10).join('、')}${
              failedNames.length > 10 ? ` 等 ${failedNames.length} 个` : ''
            }。`
          : '') +
        '这些图片在导出的 Excel 里是空的，可稍后重新导出补齐。',
    )
  }

  /* ---------- 打包 ---------- */
  const stamp = safeFileStamp()
  let blob: Blob
  let fileName: string
  let fileCount: number

  // 只有一张表时，拆与不拆结果一样，直接走单文件分支
  if (opts.packMode === 'perTable' && outSheets.length > 1) {
    report('pack', '打包文件', 0, outSheets.length, `逐表生成 ${outSheets.length} 个 Excel`)
    const zip = new JSZip()
    const used = new Set<string>()
    for (let i = 0; i < outSheets.length; i++) {
      const sheet = outSheets[i]
      report('pack', '打包文件', i, outSheets.length, `${sheet.name} · 写入文件`)
      const one = await buildXlsxBlob([sheet], {
        imageMode: opts.imageMode,
        imageSizePx: opts.imageSizePx && opts.imageSizePx > 0 ? opts.imageSizePx : undefined,
      })
      zip.file(uniqueXlsxName(sheet.name, stamp, used), one)
    }
    blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })
    fileName = `多维表格导出_${outSheets.length}个工作表_${stamp}.zip`
    fileCount = outSheets.length
  } else {
    report('pack', '生成 Excel', 0, 1, '嵌入图片并写入文件')
    blob = await buildXlsxBlob(outSheets, {
      imageMode: opts.imageMode,
      imageSizePx: opts.imageSizePx && opts.imageSizePx > 0 ? opts.imageSizePx : undefined,
    })
    fileName = `多维表格导出_${outSheets[0]?.name ?? 'data'}_${stamp}.xlsx`
    fileCount = 1
  }

  fileName = fileName.replace(/[\\/:*?"<>|]/g, '_')

  return { blob, fileName, summary, warnings, errors, fileCount }
}

/** 把一次导出的结果整理成可存档的日志行（供反馈时一键复制） */
export function buildExportLogLines(res: ExportResult, opts: {
  packMode?: ExportPackMode
  imageMode?: 'dispimg' | 'float'
}): string[] {
  const totalRecords = res.summary.reduce((n, s) => n + s.records, 0)
  return [
    `导出方式：${opts.packMode === 'perTable' ? '拆分多个 Excel' : '合并为一个 Excel'}`,
    `图片嵌入方式：${opts.imageMode === 'dispimg' ? 'WPS 嵌入单元格图片' : '标准浮动图片'}`,
    `产物：${res.fileName}（${fmtSize(res.blob.size)}）`,
    `合计：${res.summary.length} 个工作表 · ${totalRecords} 行 · ${res.summary.reduce((n, s) => n + s.images, 0)} 张图片`,
    ...res.summary.map((s) => `  · ${s.table}：${s.records} 条记录，${s.images} 张图片`),
    ...res.warnings.map((w) => `  ! ${w}`),
    ...res.errors.slice(0, 50).map((e) => `  ! ${e}`),
  ]
}

/** 工作表名 → 安全的 xlsx 文件名；同名时补序号，避免 zip 内互相覆盖 */
function uniqueXlsxName(sheetName: string, stamp: string, used: Set<string>): string {
  const base = (sheetName || '数据表').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '数据表'
  let name = `${base}_${stamp}.xlsx`
  let n = 2
  while (used.has(name)) name = `${base}_${stamp}_${n++}.xlsx`
  used.add(name)
  return name
}

export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 2000)
}

/**
 * 尽量把浏览器下载目录里刚导出的文件「亮」出来。
 *
 * 插件的 iframe 是 `sandbox="allow-downloads"` 的受控环境，**没有文件系统访问权**，
 * 不存在「打开所在文件夹」这种 API。能做的是：
 *  1) 若宿主允许，用 File System Access API 把 blob 存到用户**自己挑选**的目录
 *     （`showSaveFilePicker` 会弹出系统的保存对话框，用户选定后系统会跳转到该目录）；
 *  2) 退化方案：再触发一次同名下载，浏览器下载栏会高亮该文件，
 *     同时在界面上告诉用户去「下载」文件夹找。
 *
 * 返回 'picked' 表示用户已在系统对话框里选定位置，'fallback' 表示退化为重新下载。
 */
export type RevealOutcome = 'picked' | 'fallback' | 'cancelled'

type FilePickerWindow = Window & {
  showSaveFilePicker?: (opts: {
    suggestedName?: string
    types?: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<{
    createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>
  }>
}

export async function revealExportFile(blob: Blob, fileName: string): Promise<RevealOutcome> {
  const w = window as FilePickerWindow
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      // 拆分模式下产物是 zip，保存对话框要给出对应的类型与扩展名
      const isZip = /\.zip$/i.test(fileName)
      const handle = await w.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          isZip
            ? { description: 'ZIP 压缩包', accept: { 'application/zip': ['.zip'] } }
            : {
                description: 'Excel 工作簿',
                accept: {
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
                },
              },
        ],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return 'picked'
    } catch (e) {
      // 用户手动取消 → 不算失败，什么都不做
      const name = String((e as Error)?.name ?? '')
      if (name === 'AbortError') return 'cancelled'
      // 权限被沙箱拒绝 → 走退化路径
    }
  }
  triggerDownload(blob, fileName)
  return 'fallback'
}
