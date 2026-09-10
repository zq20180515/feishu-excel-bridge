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
import { rawToText } from './infer'
import { cellKey } from './types'
import type { FieldBrief, MediaRef, SourceColumn, SourceSheet } from './types'
import { mimeOfName } from './field-meta'
import { toBitableValue } from './value-convert'

export type ImportProgress = {
  phase: string
  done: number
  total: number
  detail?: string
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
}

export type ImportOptions = {
  skipEmptyRows: boolean
  uploadBatchSize: number
  onProgress?: (p: ImportProgress) => void
}

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
  const report = (phase: string, done: number, total: number, detail?: string) =>
    opts.onProgress?.({ phase, done, total, detail })

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
  if (tasks.length) {
    report('上传附件', 0, tasks.length)
    const { tokens, failures } = await uploadFilesSerial(
      tasks.map((t) => t.file),
      opts.uploadBatchSize,
      (done, total) => report('上传附件', done, total),
    )
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
  }

  /* ---------- 2. 逐 sheet 写入 ---------- */
  const enabledSheets = sheets.filter((s) => s.columns.some((c) => c.enabled))
  for (let si = 0; si < sheets.length; si++) {
    const sheet = sheets[si]
    const enabled = sheet.columns.filter((c) => c.enabled)
    if (!enabled.length) {
      warnings.push(`工作表「${sheet.name}」没有启用任何字段，已跳过。`)
      continue
    }

    const sheetLabel = `数据表 ${sheets.indexOf(sheet) + 1}/${sheets.length}：${sheet.name}`
    report(sheetLabel, 0, 1, '准备数据表')

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
      if (i % 50 === 0) report(sheetLabel, i, rows.length, `组装记录 ${i + 1}/${rows.length}`)
    }

    /* --- 写回 --- */
    report(sheetLabel, 0, records.length, `写入 ${records.length} 条记录`)
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
    report(sheetLabel, records.length, records.length, '完成')

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

  return { tables: results, warnings, errors }
}
