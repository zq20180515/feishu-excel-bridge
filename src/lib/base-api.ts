import { bitable } from '@lark-base-open/js-sdk'
import { FT } from './field-meta'
import type { FieldBrief, TableBrief } from './types'

/** SDK 版本间类型名有差异，这里统一按结构化数据用，避免被类型定义绑死 */
type AnyTable = any

/**
 * 是否处于多维表格插件宿主中。
 *
 * 只判断 `bitable.base` 存在是不够的：**在普通浏览器里直接打开 dev server 时，
 * SDK 对象照样存在，但它的 Promise 永远不 settle**（既 resolve 也不 reject），
 * 于是界面会一直停在「正在读取数据表…」，看起来像卡死。
 *
 * 插件一定是以 iframe 形式被飞书嵌入的，所以再加一条「是否在 iframe 内」的判断，
 * 就能在浏览器直开时给出明确提示，而不是无休止等待。
 */
export function sdkAvailable(): boolean {
  try {
    if (!bitable || !(bitable as any).base) return false
    // 跨域 iframe 里比较 window 引用本身是安全的（只有访问其属性才会抛错）
    const top = window.top
    // 非浏览器环境（如单元测试）没有 top，此时不因这条判断而否决
    if (!top) return true
    return window.self !== top
  } catch {
    return false
  }
}

export async function listTables(): Promise<TableBrief[]> {
  const metas = await (bitable.base as any).getTableMetaList()
  return (metas ?? []).map((m: any) => ({ id: m.id, name: m.name }))
}

export async function getTable(tableId: string): Promise<AnyTable> {
  return await (bitable.base as any).getTableById(tableId)
}

export async function listFields(tableId: string): Promise<FieldBrief[]> {
  const table = await getTable(tableId)
  return orderedFields(table)
}

/** getFieldMetaList 返回无序，优先用视图的字段顺序还原真实列顺序 */
export async function orderedFields(table: AnyTable): Promise<FieldBrief[]> {
  try {
    const views = await table.getViewList?.()
    if (Array.isArray(views) && views.length) {
      const metas = await views[0].getFieldMetaList()
      if (Array.isArray(metas) && metas.length) {
        return metas.map((m: any) => ({ id: m.id, name: m.name, type: Number(m.type) }))
      }
    }
  } catch {
    /* 降级 */
  }
  const metas = await table.getFieldMetaList()
  return (metas ?? []).map((m: any) => ({ id: m.id, name: m.name, type: Number(m.type) }))
}

/** 找同名数据表；没有则新建。返回 tableId */
export async function ensureTable(name: string, allowReuse: boolean): Promise<{ tableId: string; created: boolean }> {
  const existing = await listTables()
  if (allowReuse) {
    const hit = existing.find((t) => t.name === name)
    if (hit) return { tableId: hit.id, created: false }
  }
  const used = new Set(existing.map((t) => t.name))
  let finalName = name || '导入数据'
  let i = 2
  while (used.has(finalName)) finalName = `${name}(${i++})`
  const res = await (bitable.base as any).addTable({ name: finalName })
  const tableId = typeof res === 'string' ? res : res?.tableId
  if (!tableId) throw new Error('新建数据表失败')
  return { tableId, created: true }
}

export async function addField(table: AnyTable, name: string, type: number): Promise<string> {
  const fieldId = await table.addField({ name, type })
  return typeof fieldId === 'string' ? fieldId : (fieldId as any)?.id
}

/**
 * 新建数据表时，多维表格会自动补一个「文本」类型的第一列（名字通常就是「文本」）。
 * 如果不管它，导入后第一列会是一列空白，看起来像插件漏了一列。
 * 这里在写完字段后收尾：把自动生成的那一列复用/改成第一个源字段，多余的删掉。
 *
 * @param keepFieldIds 真正承载数据的字段 id（导入时新建或复用的）
 * @param renamedTo    被征用的默认列 -> 目标字段名
 */
export async function adoptDefaultField(
  table: AnyTable,
  fieldId: string,
  name: string,
  type: number,
): Promise<boolean> {
  try {
    await table.setField(fieldId, { name, type } as any)
    return true
  } catch {
    try {
      await table.setField(fieldId, { name, type: FT.Text } as any)
      return true
    } catch {
      return false
    }
  }
}

export async function deleteField(table: AnyTable, fieldId: string): Promise<boolean> {
  try {
    return !!(await table.deleteField(fieldId))
  } catch {
    return false
  }
}

/** 新建表时自动生成、且不是我们目标字段的「孤儿字段」，按创建顺序返回 */
export function orphanFields(fields: FieldBrief[], keepIds: Set<string>): FieldBrief[] {
  return fields.filter((f) => !keepIds.has(f.id))
}

/** 单选/多选：把取值补成选项，失败不阻塞。返回「选项名 -> 选项 id」映射 */
export async function preAddOptions(
  table: AnyTable,
  fieldId: string,
  type: number,
  values: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (!values.length) return map
  try {
    const field: any = await table.getField(fieldId)
    if (typeof field?.addOption !== 'function') return map
    for (const v of values.slice(0, 200)) {
      try {
        await field.addOption(v)
      } catch {
        /* 选项已存在 / 非法值，忽略 */
      }
    }
  } catch {
    /* 忽略 */
  }
  // 建完再回读一次，拿到真实的选项 id —— 写单元格必须用 id，用文本会被静默丢弃
  return await readOptionMap(table, fieldId, map)
}

/**
 * 读取单选/多选字段的选项 id 映射。
 * 关键：多维表格写单选/多选单元格时，值必须是 { id, text }；
 * 只传纯文本（或只有 text 没有 id）时接口不会报错，但单元格会保持空白。
 */
export async function readOptionMap(
  table: AnyTable,
  fieldId: string,
  into?: Map<string, string>,
): Promise<Map<string, string>> {
  const map = into ?? new Map<string, string>()
  try {
    const field: any = await table.getField(fieldId)
    if (typeof field?.getOptions !== 'function') return map
    const opts = await field.getOptions()
    if (!Array.isArray(opts)) return map
    for (const o of opts) {
      const name = String(o?.name ?? '').trim()
      const id = String(o?.id ?? '')
      if (name && id) map.set(name, id)
    }
  } catch {
    /* 忽略 */
  }
  return map
}

export async function addRecords(table: AnyTable, records: { fields: Record<string, unknown> }[]): Promise<number> {
  const CHUNK = 200 // 官方限制：单次 200 条
  let n = 0
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK)
    const res = await table.addRecords(slice)
    n += Array.isArray(res) ? res.length : slice.length
  }
  return n
}

export async function fetchAllRecords(table: AnyTable): Promise<any[]> {
  const out: any[] = []
  const CHUNK = 200
  if (typeof table.getRecordsByPage === 'function') {
    let pageToken: string | undefined
    let guard = 0
    for (;;) {
      const res = await table.getRecordsByPage({ pageSize: CHUNK, pageToken })
      out.push(...(res?.records ?? []))
      if (!res?.hasMore || guard++ > 1000) break
      pageToken = res.pageToken
    }
    return out
  }
  if (typeof table.getRecords === 'function') {
    let pageToken: string | undefined
    let guard = 0
    for (;;) {
      const res = await table.getRecords({ pageSize: CHUNK, pageToken })
      out.push(...(res?.records ?? []))
      if (!res?.hasMore || guard++ > 1000) break
      pageToken = res.pageToken
    }
  }
  return out
}

export async function getAttachmentUrls(table: AnyTable, tokens: string[], fieldId: string, recordId: string): Promise<string[]> {
  if (!tokens.length) return []
  try {
    const res = await table.getCellAttachmentUrls(tokens, fieldId, recordId)
    return Array.isArray(res) ? res : []
  } catch {
    return []
  }
}

/* --------------------------- 附件上传（串行） --------------------------- */

/**
 * batchUploadFile 官方明确要求「禁止并发调用」，这里用一条全局串行链把它串起来。
 * 批量失败时降级为逐个上传，尽量把成功的部分捞回来。
 */
let uploadChain: Promise<unknown> = Promise.resolve()

/**
 * 上传超时的下限 / 上限（毫秒）。
 *
 * ⚠️ 这个保护是必须的：飞书的上传接口在个别文件上会**既不返回也不报错**地挂住，
 * 而 `await` 会一直等下去 —— 表现就是导入卡在某个数字上不动。
 *
 * 额度按**实测速度**定，不靠猜：
 *   439 个附件 / 92 MB 的导入，最慢的单张也只有 0.6 秒、最大 868 KB，
 *   平均约 0.7 秒/张 —— 折算下来串行上传约 5.4 秒/MB。
 * 所以给到 8 秒/MB（约 50% 余量）就够，超过这个量级基本可以断定是**卡住**，
 * 而不是「量太大传得慢」。早放弃反而更好：失败会落到明细里，可逐张重试。
 */
const UPLOAD_TIMEOUT_MIN_MS = 30_000
const UPLOAD_TIMEOUT_MAX_MS = 3 * 60_000
/** 每 MB 给多少毫秒的额度（按实测 5.4 秒/MB 留约 50% 余量） */
const UPLOAD_TIMEOUT_PER_MB_MS = 8_000

/**
 * 批量上传失败后逐个兜底时，连续失败这么多个就停止兜底。
 *
 * 连续失败说明是接口层面的系统性问题（限流 / 网络），不是某一个文件坏了，
 * 继续一个个试只是白等 —— 每个 15 秒的话，30 个就是 7 分半。
 */
const MAX_CONSECUTIVE_FALLBACK_FAILS = 5

/** 逐个兜底时单文件的超时额度（实测单张 0.7 秒，15 秒足够判定异常） */
const UPLOAD_ONE_TIMEOUT_MS = 15_000

/**
 * 批次之间的间隔（毫秒）。
 *
 * 「卡在 210 后又自己恢复」这个现象，最符合**服务端限流 + SDK 内部退避重试**：
 * 累计上传到一定量后服务端开始拖慢/拒绝，SDK 按退避策略反复重试，
 * 从外面看就是「一个一百多 K 的小文件半天没动静」。
 *
 * 与其等它卡住再靠超时兜底，不如主动留一点间隔，别把服务端逼到限流 ——
 * 15 批 × 250ms 才多花不到 4 秒，比卡几分钟划算得多。
 */
const UPLOAD_BATCH_GAP_MS = 250

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 按待传字节数估算超时额度：大文件给更久，但也设上限避免真的无限等 */
function timeoutForFiles(files: { size?: number }[], floorMs = UPLOAD_TIMEOUT_MIN_MS): number {
  const totalMb = files.reduce((n, f) => n + (f.size || 0), 0) / 1024 / 1024
  const budget = Math.ceil(totalMb * UPLOAD_TIMEOUT_PER_MB_MS)
  return Math.min(UPLOAD_TIMEOUT_MAX_MS, Math.max(floorMs, budget))
}

/**
 * 给 Promise 套一层超时；超时抛出可读错误，交由上层记为失败并继续。
 * 导出给 exporter 复用 —— SDK 调用挂起是各处的共同风险。
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`${label}超时（${Math.round(ms / 1000)} 秒无响应）`))
    }, ms)
    p.then(
      (v) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** 单个附件的上传耗时记录，用于事后定位「哪张图拖慢了整次导入」 */
export type UploadFileTiming = {
  name: string
  /** 字节数 */
  size: number
  /** 耗时（毫秒） */
  ms: number
  ok: boolean
  message?: string
}

export type UploadOutcome = {
  tokens: (string | null)[]
  failures: { index: number; name: string; message: string }[]
  /** 每个文件的耗时明细（批量成功的按文件均值摊分） */
  timings: UploadFileTiming[]
}

/** 上传进度；`current` 让界面能显示「正在上传 xxx.jpg（3.2 MB）」 */
export type UploadProgressInfo = {
  done: number
  total: number
  current?: { name: string; size: number }
}

export function uploadFilesSerial(
  files: File[],
  batchSize = 10,
  onProgress?: (info: UploadProgressInfo) => void,
  opts?: { timeoutMs?: number; shouldStop?: () => boolean },
): Promise<UploadOutcome> {
  const run = async (): Promise<UploadOutcome> => {
    const tokens: (string | null)[] = new Array(files.length).fill(null)
    const failures: UploadOutcome['failures'] = []
    const timings: UploadFileTiming[] = []
    let done = 0
    const size = Math.max(1, batchSize)
    const report = (current?: UploadProgressInfo['current']) =>
      onProgress?.({ done, total: files.length, current })

    /** 单文件兜底上传：批量没返回这个文件的 token 时走这里，顺便把「哪张图有问题」定位出来 */
    const uploadOne = async (idx: number): Promise<void> => {
      const f = files[idx]
      const budget = opts?.timeoutMs ?? timeoutForFiles([f], UPLOAD_ONE_TIMEOUT_MS)
      // 先报「正在传哪个、多大」，卡住时用户也能看出是哪张图在拖
      report({ name: f.name, size: f.size || 0 })
      const t0 = Date.now()
      let ok = false
      let msg: string | undefined
      try {
        const res = await withTimeout(
          (bitable.base as any).batchUploadFile([f]),
          budget,
          `附件「${f.name}」`,
        )
        const t = Array.isArray(res) ? res[0] : undefined
        if (t) {
          tokens[idx] = t
          ok = true
        } else {
          msg = '上传未返回 token'
        }
      } catch (err) {
        msg = String((err as Error)?.message ?? err)
      }
      if (!ok) failures.push({ index: idx, name: f.name, message: msg ?? '上传失败' })
      timings.push({ name: f.name, size: f.size || 0, ms: Date.now() - t0, ok, message: msg })
      done++
    }

    for (let i = 0; i < files.length; i += size) {
      if (opts?.shouldStop?.()) break
      const slice = files.slice(i, i + size)
      const budget = opts?.timeoutMs ?? timeoutForFiles(slice)
      const batchMb = slice.reduce((n, f) => n + (f.size || 0), 0) / 1024 / 1024
      const batchStart = Date.now()

      // 先把「本批有多少、多大」报出去 —— 大附件慢的时候用户能对上号
      report({ name: `本批 ${slice.length} 个（${batchMb.toFixed(1)} MB）`, size: 0 })

      try {
        const res = await withTimeout(
          (bitable.base as any).batchUploadFile(slice),
          budget,
          `第 ${i + 1}–${i + slice.length} 个附件（${batchMb.toFixed(1)} MB）`,
        )
        const list: string[] = Array.isArray(res) ? res : []
        slice.forEach((f, k) => {
          if (list[k]) tokens[i + k] = list[k]
        })
      } catch {
        // 整批失败（含超时）：不在这里记失败，交给下面的逐个兜底去定位具体文件
      }

      const batchMs = Date.now() - batchStart
      if (slice.every((_f, k) => !!tokens[i + k])) {
        // 批量成功：接口不提供单文件耗时，按文件均摊
        const each = Math.round(batchMs / slice.length)
        slice.forEach((f) => timings.push({ name: f.name, size: f.size || 0, ms: each, ok: true }))
        done += slice.length
      } else {
        /*
         * 批量没成功 → 逐个兜底，顺便定位是哪个文件有问题。
         *
         * 但要有熔断：连续失败若干个说明是接口层面的问题（限流 / 网络），
         * 不是某一个文件坏了。继续一个个试只是白等 ——
         * 每个 15 秒的话，一批 30 个就是 7 分半，用户看到的就是「卡住不动」。
         */
        let consecutiveFail = 0
        for (let k = 0; k < slice.length; k++) {
          const idx = i + k
          if (tokens[idx]) {
            done++
            continue
          }
          if (opts?.shouldStop?.()) break

          const failsBefore = failures.length
          await uploadOne(idx)

          if (failures.length > failsBefore) {
            consecutiveFail++
            if (consecutiveFail >= MAX_CONSECUTIVE_FALLBACK_FAILS) {
              // 剩余的直接标记跳过，别再把时间耗在注定失败的尝试上
              for (let j = k + 1; j < slice.length; j++) {
                const jdx = i + j
                if (tokens[jdx]) {
                  done++
                  continue
                }
                const f = files[jdx]
                const message = `批量上传失败，逐个重传又连续失败 ${consecutiveFail} 个，已跳过（多半是接口限流或网络问题，可稍后重试）`
                failures.push({ index: jdx, name: f.name, message })
                timings.push({ name: f.name, size: f.size || 0, ms: 0, ok: false, message })
                done++
              }
              break
            }
          } else {
            consecutiveFail = 0
          }
        }
      }
      report()

      // 批间留一点间隔，主动避免把服务端逼到限流（最后一批不用等）
      if (i + size < files.length && !opts?.shouldStop?.()) {
        await sleep(UPLOAD_BATCH_GAP_MS)
      }
    }
    return { tokens, failures, timings }
  }

  const p = uploadChain.then(run, run)
  uploadChain = p.catch(() => undefined)
  return p
}
