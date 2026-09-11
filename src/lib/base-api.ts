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

export type UploadOutcome = {
  tokens: (string | null)[]
  failures: { index: number; name: string; message: string }[]
}

export function uploadFilesSerial(
  files: File[],
  batchSize = 10,
  onProgress?: (done: number, total: number) => void,
): Promise<UploadOutcome> {
  const run = async (): Promise<UploadOutcome> => {
    const tokens: (string | null)[] = new Array(files.length).fill(null)
    const failures: UploadOutcome['failures'] = []
    let done = 0
    const size = Math.max(1, batchSize)

    for (let i = 0; i < files.length; i += size) {
      const slice = files.slice(i, i + size)
      try {
        const res = await (bitable.base as any).batchUploadFile(slice)
        const list: string[] = Array.isArray(res) ? res : []
        slice.forEach((f, k) => {
          if (list[k]) tokens[i + k] = list[k]
        })
        slice.forEach((f, k) => {
          if (!tokens[i + k]) {
            // 数量对不上，逐个补
          }
        })
      } catch (e) {
        // 降级：逐个上传
        for (let k = 0; k < slice.length; k++) {
          const f = slice[k]
          try {
            const res = await (bitable.base as any).batchUploadFile([f])
            const t = Array.isArray(res) ? res[0] : undefined
            if (t) tokens[i + k] = t
            else failures.push({ index: i + k, name: f.name, message: '上传未返回 token' })
          } catch (err) {
            failures.push({ index: i + k, name: f.name, message: String((err as Error)?.message ?? err) })
          }
        }
        void e
      }
      done += slice.length
      onProgress?.(done, files.length)
    }
    return { tokens, failures }
  }

  const p = uploadChain.then(run, run)
  uploadChain = p.catch(() => undefined)
  return p
}
