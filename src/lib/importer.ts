import { FT, READONLY_TYPES, fieldTypeLabel } from './field-meta'
import {
  addField,
  addRecords,
  adoptDefaultField,
  deleteField,
  ensureTable,
  getTable,
  orderedFields,
  preAddOptions,
  readOptionMap,
  uploadFilesSerial,
} from './base-api'
import type { UploadFileTiming } from './base-api'
import { rawToText } from './infer'
import { cellKey } from './types'
import type { FieldBrief, MediaRef, SourceColumn, SourceSheet, StageItem } from './types'
import { mimeOfName } from './field-meta'
import { toBitableValue } from './value-convert'

/** 导入的四个阶段，供 UI 渲染阶段清单 */
export type ImportStage = 'parse' | 'media' | 'fields' | 'records'

export type ImportProgress = {
  phase: string
  done: number
  total: number
  detail?: string
  /** 当前处于哪个阶段（用于打勾清单） */
  stage?: ImportStage
  /** 当前阶段的明细（上传阶段是每个附件的状态，可展开查看） */
  items?: StageItem[]
}

export type ImportSheetResult = {
  sheet: string
  tableId: string
  tableName: string
  createdFields: number
  reusedFields: number
  records: number
  skippedCells: number
}

export type ImportResult = {
  tables: ImportSheetResult[]
  warnings: string[]
  errors: { sheet: string; row: number; column: string; message: string }[]
  /** 用户中途取消（已写入的数据表与记录不会回滚） */
  cancelled?: boolean
  /** 附件上传耗时明细（按耗时降序），用于定位「哪张图拖慢了整次导入」 */
  uploadTimings?: UploadFileTiming[]
}

export type ImportOptions = {
  skipEmptyRows: boolean
  uploadBatchSize: number
  /** 返回 true 时在下一个检查点停止，已写入的内容保留 */
  shouldStop?: () => boolean
  onProgress?: (p: ImportProgress) => void
}

/** 人类可读的体积 */
function fmtSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const mb = bytes / 1024 / 1024
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** 单个附件超过这个耗时就算「慢」，会汇总进结果里 */
const SLOW_UPLOAD_MS = 8_000

type Resolved = {
  column: SourceColumn
  fieldId: string
  type: number
  name: string
  isNew: boolean
}

function dataRowIndexes(sheet: SourceSheet): number[] {
  const out: number[] = []
  for (let r = sheet.headerRowIndex + 1; r < sheet.matrix.length; r++) out.push(r)
  return out
}

/**
 * 找出新建数据表时多维表格自动补出来的空白列。
 * 判定条件：文本类型（1）且名字是「文本」/「空白」这类默认名。
 * 只在 createdTable = true 时调用，所以不会误伤用户自己建的同名列。
 */
function detectSpareFields(fields: FieldBrief[]): FieldBrief[] {
  const DEFAULT_NAMES = /^(文本|空白|空白列|多行文本|Text|Column\s*\d*)$/i
  return fields.filter((f) => f.type === FT.Text && DEFAULT_NAMES.test((f.name || '').trim()))
}

/** 收集某一列在单选/多选场景下需要用到的全部选项文本 */
function collectSelectValues(sheet: SourceSheet, col: SourceColumn, type: number): string[] {
  const distinct = new Set<string>()
  for (const r of dataRowIndexes(sheet)) {
    const raw = sheet.matrix[r]?.[col.col] ?? null
    const t = rawToText(raw).trim()
    if (!t) continue
    if (type === FT.SingleSelect) distinct.add(t)
    else t.split(/[,，;；|、\/]/).forEach((x) => x.trim() && distinct.add(x.trim()))
    if (distinct.size > 200) break
  }
  return [...distinct]
}

/**
 * 导入执行器：
 * 1. 把所有图片串行上传（batchUploadFile 禁止并发）
 * 2. 每个 sheet 建表 / 复用表
 * 3. 逐列解析目标字段（复用已有 or 新建）
 * 4. 组装记录，每 200 条一批写回
 */
export async function runImport(sheets: SourceSheet[], opts: ImportOptions): Promise<ImportResult> {
  const warnings: string[] = []
  const errors: ImportResult['errors'] = []
  const results: ImportSheetResult[] = []
  const report = (
    stage: ImportStage,
    phase: string,
    done: number,
    total: number,
    detail?: string,
    items?: StageItem[],
  ) => opts.onProgress?.({ stage, phase, done, total, detail, items })

  /** 用户在界面上点了「取消」 */
  const stop = () => opts.shouldStop?.() === true
  /**
   * 中途停止时返回已经完成的部分。
   * 已经建好的数据表 / 字段 / 记录**不会回滚** —— 多维表格没有事务，
   * 与其假装撤销，不如如实告诉用户哪些已经落地了。
   */
  const cancelledResult = (): ImportResult => ({
    tables: results,
    warnings: [...warnings, '已取消导入，剩余内容未写入。已创建的数据表与已写入的记录会保留在表格中。'],
    errors,
    cancelled: true,
  })

  /* ---------- 1. 收集并上传附件 ---------- */
  const tasks: { sheetIdx: number; row: number; col: number; file: File }[] = []
  sheets.forEach((sheet, si) => {
    for (const col of sheet.columns) {
      if (!col.enabled) continue
      if (col.targetFieldType !== FT.Attachment) continue
      for (const r of dataRowIndexes(sheet)) {
        const files = sheet.mediaByCell.get(cellKey(r, col.col))
        if (!files?.length) continue
        for (const f of files) tasks.push({ sheetIdx: si, row: r, col: col.col, file: f })
      }
    }
  })

  const mediaBySheet = new Map<number, Map<string, MediaRef[]>>()
  /** 附件上传耗时明细（保留到结果里，用于定位是哪张图拖慢了整次导入） */
  let uploadTimings: UploadFileTiming[] = []
  if (stop()) return cancelledResult()

  /*
   * ⚠️ 这里**刻意不做去重**。
   *
   * 曾经按「文件名 + 大小」把附件收敛成唯一文件、再复用同一个 token ——
   * 这个做法被否掉了，因为它有致命风险：一旦有两个**内容不同但恰好同名同大小**
   * 的图片，后者会复用前者的 token，结果就是**单元格里被填进错误的图片、
   * 原图丢失**。这是不可逆的数据错误，比上传慢严重得多。
   *
   * 文件名并不是内容指纹（WPS 的 cellimages 里 ID 与 media 的对应关系
   * 也未必一一对应），拿它判断"是不是同一张图"太武断。
   * 宁可多传几次、慢一点，也不能冒填错图的风险。
   */
  if (tasks.length) {
    /** 每张图一条明细，供界面展开查看「传到哪一张了、有多大」 */
    const mediaItems: StageItem[] = tasks.map((t) => ({
      label: t.file.name,
      meta: fmtSize(t.file.size || 0),
      state: 'pending',
    }))
    report('media', '正在上传附件图片', 0, tasks.length, `共 ${tasks.length} 个图片/附件`, mediaItems)

    const { tokens, failures, timings } = await uploadFilesSerial(
      tasks.map((t) => t.file),
      opts.uploadBatchSize,
      ({ done, total, current }) => {
        // 前 done 个已完成、第 done 个正在传、其余待传
        for (let i = 0; i < mediaItems.length; i++) {
          mediaItems[i].state = i < done ? 'done' : i === done ? 'active' : 'pending'
        }
        report(
          'media',
          '正在上传附件图片',
          done,
          total,
          current
            ? `正在上传 ${current.name}${current.size ? `（${fmtSize(current.size)}）` : ''}`
            : `已完成 ${done} / ${total} 个`,
          mediaItems,
        )
      },
      { shouldStop: opts.shouldStop },
    )
    uploadTimings = timings

    // 回填每张图的耗时，并把失败的标出来
    timings.forEach((t, i) => {
      if (!mediaItems[i]) return
      mediaItems[i].meta = `${fmtSize(t.size)} · ${(t.ms / 1000).toFixed(1)}s`
      if (!t.ok) mediaItems[i].state = 'fail'
    })
    tasks.forEach((t, i) => {
      const token = tokens[i]
      if (!token) return
      const key = cellKey(t.row, t.col)
      let cellMap = mediaBySheet.get(t.sheetIdx)
      if (!cellMap) {
        cellMap = new Map()
        mediaBySheet.set(t.sheetIdx, cellMap)
      }
      const list = cellMap.get(key) ?? []
      list.push({
        row: t.row,
        col: t.col,
        name: t.file.name,
        size: t.file.size,
        type: t.file.type || mimeOfName(t.file.name),
        token,
      })
      cellMap.set(key, list)
    })
    for (const f of failures) {
      errors.push({ sheet: '—', row: -1, column: '附件', message: `附件「${f.name}」上传失败：${f.message}` })
    }

    /*
     * 汇总「慢附件」—— 这是「进度长时间不动」最常见的原因：
     * 不是卡死，而是某个几十 MB 的文件在串行上传里慢慢传。
     * 把文件名和体积列出来，用户才知道该去处理哪张图。
     */
    const totalBytes = timings.reduce((n, t) => n + t.size, 0)
    const slow = timings.filter((t) => t.ok && t.ms > SLOW_UPLOAD_MS).sort((a, b) => b.ms - a.ms)
    if (slow.length > 0) {
      const top = slow
        .slice(0, 5)
        .map((t) => `${t.name}（${fmtSize(t.size)}，${(t.ms / 1000).toFixed(1)} 秒）`)
      warnings.push(
        `有 ${slow.length} 个附件单个上传耗时超过 ${SLOW_UPLOAD_MS / 1000} 秒` +
          `（本次共 ${timings.length} 个附件，合计 ${fmtSize(totalBytes)}）。` +
          `最慢的是：${top.join('、')}。附件只能串行上传，超大文件会让进度长时间停在同一处。`,
      )
    } else if (totalBytes > 100 * 1024 * 1024) {
      warnings.push(
        `本次共上传 ${timings.length} 个附件，合计 ${fmtSize(totalBytes)}。` +
          '附件必须串行上传（飞书接口限制），体积越大耗时越长，属正常现象。',
      )
    }
  }

  /* ---------- 2. 逐 sheet 写入 ---------- */
  const enabledSheets = sheets.filter((s) => s.columns.some((c) => c.enabled))
  for (let si = 0; si < sheets.length; si++) {
    if (stop()) return cancelledResult()
    const sheet = sheets[si]
    const enabled = sheet.columns.filter((c) => c.enabled)
    if (!enabled.length) {
      warnings.push(`工作表「${sheet.name}」没有启用任何字段，已跳过。`)
      continue
    }

    const sheetLabel = `数据表 ${sheets.indexOf(sheet) + 1}/${sheets.length}：${sheet.name}`
    report('fields', '正在准备数据表', si, sheets.length, sheetLabel)

    let tableId = ''
    let tableName = sheet.importTableName || sheet.name
    let createdTable = false
    if (sheet.importMode === 'append' && sheet.importTableId) {
      tableId = sheet.importTableId
    } else {
      const created = await ensureTable(sheet.importTableName || sheet.name, false)
      tableId = created.tableId
      createdTable = created.created
    }
    const table = await getTable(tableId)
    try {
      tableName = (await table.getName()) || tableName
    } catch {
      /* 忽略 */
    }

    let existing: FieldBrief[] = []
    try {
      existing = await orderedFields(table)
    } catch {
      existing = []
    }
    const byName = new Map(existing.map((f) => [f.name, f]))

    /**
     * 新建数据表时，多维表格会自动补一列「文本」放在最左侧。
     * 如果放着不管，导入后第一列就是一列空白 —— 看起来像插件少了一列。
     * 这里把这一列征用成第一个源字段，源字段多于默认列时再删除多余的。
     */
    const spareFields = createdTable ? detectSpareFields(existing) : []

    /* --- 解析目标字段 --- */
    const resolved: Resolved[] = []
    let createdFields = 0
    let reusedFields = 0

    /** 单选/多选的选项 id 映射：fieldId -> (选项名 -> 选项 id) */
    const optionMaps = new Map<string, Map<string, string>>()

    /** 把自动生成的空白列改造成目标字段（比新建+删旧更干净，也不会改变列顺序） */
    const adoptSpare = async (wantName: string, wantType: number, col: SourceColumn): Promise<string> => {
      const spare = spareFields.shift()
      if (!spare) return ''
      let effectiveType = wantType
      let ok = await adoptDefaultField(table, spare.id, wantName, effectiveType)
      if (!ok && wantType !== FT.Text) {
        // 该类型在当前租户不受支持时降级为多行文本
        effectiveType = FT.Text
        ok = await adoptDefaultField(table, spare.id, wantName, effectiveType)
        if (ok) {
          warnings.push(`字段「${wantName}」以「${fieldTypeLabel(wantType)}」创建失败，已降级为多行文本。`)
        }
      }
      if (!ok) {
        spareFields.unshift(spare)
        return ''
      }
      const meta: FieldBrief = { id: spare.id, name: wantName, type: effectiveType }
      existing.push(meta)
      byName.set(wantName, meta)
      resolved.push({ column: col, fieldId: spare.id, type: effectiveType, name: wantName, isNew: true })
      createdFields++
      if (effectiveType === FT.SingleSelect || effectiveType === FT.MultiSelect) {
        const map = await preAddOptions(table, spare.id, effectiveType, collectSelectValues(sheet, col, effectiveType))
        optionMaps.set(spare.id, map)
      }
      return spare.id
    }

    for (const col of enabled) {
      // a) 映射到已有字段
      if (col.targetFieldId) {
        const meta = existing.find((f) => f.id === col.targetFieldId)
        if (!meta) {
          warnings.push(`「${sheet.name}」的字段「${col.header}」指向的目标字段已不存在，已改为按名称新建/复用。`)
        } else if (READONLY_TYPES.has(meta.type)) {
          errors.push({
            sheet: sheet.name,
            row: -1,
            column: col.header,
            message: `目标字段「${meta.name}」是${fieldTypeLabel(meta.type)}类型，不支持写入，已跳过该列。`,
          })
          continue
        } else {
          resolved.push({ column: col, fieldId: meta.id, type: meta.type, name: meta.name, isNew: false })
          reusedFields++
          if (meta.type === FT.SingleSelect || meta.type === FT.MultiSelect) {
            let map = optionMaps.get(meta.id)
            if (!map) {
              map = await readOptionMap(table, meta.id)
              optionMaps.set(meta.id, map)
            }
          }
          continue
        }
      }

      const wantName = (col.targetFieldName || col.header).trim() || col.header
      const wantType = col.targetFieldType

      if (READONLY_TYPES.has(wantType)) {
        errors.push({
          sheet: sheet.name,
          row: -1,
          column: col.header,
          message: `${fieldTypeLabel(wantType)}类型不能由插件写入，已跳过该列。`,
        })
        continue
      }

      // b) 同名已有字段 -> 复用
      const sameName = byName.get(wantName)
      if (sameName) {
        if (READONLY_TYPES.has(sameName.type)) {
          errors.push({
            sheet: sheet.name,
            row: -1,
            column: col.header,
            message: `同名字段「${wantName}」是${fieldTypeLabel(sameName.type)}类型，无法写入，已跳过。`,
          })
          continue
        }
        resolved.push({ column: col, fieldId: sameName.id, type: sameName.type, name: sameName.name, isNew: false })
        reusedFields++
        if (sameName.type === FT.SingleSelect || sameName.type === FT.MultiSelect) {
          let map = optionMaps.get(sameName.id)
          if (!map) {
            map = await readOptionMap(table, sameName.id)
            optionMaps.set(sameName.id, map)
          }
        }
        continue
      }

      // c) 新建（优先征用新建表自动生成的空白列）
      let effectiveType = wantType
      let fieldId = ''
      try {
        fieldId = await adoptSpare(wantName, wantType, col)
      } catch (e) {
        errors.push({
          sheet: sheet.name,
          row: -1,
          column: col.header,
          message: `字段「${wantName}」初始化失败：${String((e as Error)?.message ?? e)}`,
        })
        continue
      }
      if (fieldId) continue

      try {
        fieldId = await addField(table, wantName, wantType)
      } catch (e) {
        // 该字段类型在当前租户/表格里不受支持时，降级为多行文本，而不是整列丢失
        if (wantType !== FT.Text) {
          try {
            fieldId = await addField(table, wantName, FT.Text)
            effectiveType = FT.Text
            warnings.push(
              `字段「${wantName}」以「${fieldTypeLabel(wantType)}」创建失败，已降级为多行文本：${String(
                (e as Error)?.message ?? e,
              )}`,
            )
          } catch (e2) {
            errors.push({
              sheet: sheet.name,
              row: -1,
              column: col.header,
              message: `新建字段「${wantName}」失败：${String((e2 as Error)?.message ?? e2)}`,
            })
            continue
          }
        } else {
          errors.push({
            sheet: sheet.name,
            row: -1,
            column: col.header,
            message: `新建字段「${wantName}」失败：${String((e as Error)?.message ?? e)}`,
          })
          continue
        }
      }

      try {
        const meta: FieldBrief = { id: fieldId, name: wantName, type: effectiveType }
        existing.push(meta)
        byName.set(wantName, meta)
        resolved.push({ column: col, fieldId, type: effectiveType, name: wantName, isNew: true })
        createdFields++

        if (effectiveType === FT.SingleSelect || effectiveType === FT.MultiSelect) {
          const map = await preAddOptions(table, fieldId, effectiveType, collectSelectValues(sheet, col, effectiveType))
          optionMaps.set(fieldId, map)
        }
      } catch (e) {
        errors.push({
          sheet: sheet.name,
          row: -1,
          column: col.header,
          message: `字段「${wantName}」初始化失败：${String((e as Error)?.message ?? e)}`,
        })
      }
    }

    // 源字段少于自动生成的空白列时，把用不上的空白列删掉，避免留一列空
    for (const spare of spareFields) {
      const leftoverName = spare.name || '空白列'
      const ok = await deleteField(table, spare.id)
      if (ok) warnings.push(`已删除新建数据表时自动生成的空白列「${leftoverName}」。`)
      else warnings.push(`「${sheet.name}」的空白列「${leftoverName}」未能删除，可手动删除。`)
    }

    if (!resolved.length) {
      warnings.push(`工作表「${sheet.name}」没有可写入的字段，已跳过。`)
      continue
    }

    /* --- 组装记录 --- */
    const cellMap = mediaBySheet.get(si)
    const rows = dataRowIndexes(sheet)
    const records: { fields: Record<string, unknown> }[] = []
    let skippedCells = 0

    for (let i = 0; i < rows.length; i++) {
      if (i % 20 === 0 && stop()) return cancelledResult()
      const r = rows[i]
      const rowValues = sheet.matrix[r] ?? []
      const fields: Record<string, unknown> = {}
      let hasAny = false

      for (const rc of resolved) {
        const raw = rowValues[rc.column.col] ?? null
        const media = cellMap?.get(cellKey(r, rc.column.col)) ?? []
        const conv = toBitableValue(rc.type, raw, { media, options: optionMaps.get(rc.fieldId) })
        if (!conv.ok) {
          skippedCells++
          const isEmpty = raw === null || raw === undefined || rawToText(raw).trim() === ''
          if (!isEmpty && media.length === 0) {
            errors.push({
              sheet: sheet.name,
              row: r + 1,
              column: rc.column.header,
              message: `跳过：${conv.reason}`,
            })
          }
          continue
        }
        const v = conv.value
        if (v === '' || v === null || (Array.isArray(v) && v.length === 0)) continue
        fields[rc.fieldId] = v
        hasAny = true
      }

      if (!hasAny) {
        if (opts.skipEmptyRows) continue
        if (!resolved.length) continue
      }
      records.push({ fields })
      if (i % 50 === 0)
        report('records', '正在写入记录', i, rows.length, `${sheet.name} · 第 ${i + 1} / ${rows.length} 行`)
    }

    /* --- 写回 --- */
    report('records', '正在写入记录', 0, records.length, `${sheet.name} · 共 ${records.length} 条记录`)
    let written = 0
    try {
      written = await addRecords(table, records)
    } catch (e) {
      errors.push({
        sheet: sheet.name,
        row: -1,
        column: '—',
        message: `写入记录失败：${String((e as Error)?.message ?? e)}`,
      })
    }
    report('records', '正在写入记录', records.length, records.length, `${sheet.name} · 完成`)

    results.push({
      sheet: sheet.name,
      tableId,
      tableName,
      createdFields,
      reusedFields,
      records: written,
      skippedCells,
    })
  }

  return { tables: results, warnings, errors, uploadTimings }
}
