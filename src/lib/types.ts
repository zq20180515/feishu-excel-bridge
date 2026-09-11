export type TableBrief = { id: string; name: string }
export type FieldBrief = { id: string; name: string; type: number }

/** 从 Excel 里抠出来的一个附件 */
export type CellMedia = {
  /** 0-based 绝对行号（含表头行） */
  row: number
  /** 0-based 列号 */
  col: number
  file: File
}

/** 上传成功后回填的 token */
export type MediaRef = {
  row: number
  col: number
  name: string
  size: number
  type: string
  token: string
}

export type CellRaw = string | number | boolean | Date | null

export type SourceColumn = {
  /** `${sheetName}::${colIndex}`，全表唯一 */
  key: string
  sheet: string
  /** 0-based 列号 */
  col: number
  /** A / B / ... / AA */
  letter: string
  header: string
  /** 前若干行的样例（用于展示 + 类型推断） */
  samples: string[]
  /** 非空单元格数量 */
  valueCount: number
  /** 该列内嵌的图片/附件数量 */
  mediaCount: number
  /** 自动推断出来的类型 */
  inferredType: number
  /** 是否参与导入；取消勾选 = 该字段不导入 */
  enabled: boolean
  /** 目标字段 id；空字符串表示新建字段 */
  targetFieldId: string
  /** 新建字段时的字段名 */
  targetFieldName: string
  /** 目标字段类型 */
  targetFieldType: number
  /** 用户在界面上手改过类型后置 true，后续不再被自动推断覆盖 */
  typeTouched: boolean
}

export type SourceSheet = {
  name: string
  /** 原始矩阵（含表头行），索引与 Excel 行列一致 */
  matrix: CellRaw[][]
  headerRowIndex: number
  columns: SourceColumn[]
  /** 数据行数（不含表头） */
  totalDataRows: number
  /** `${row}::${col}` -> 该单元格中的图片 */
  mediaByCell: Map<string, File[]>
  /** 目标数据表名 */
  importTableName: string
  /** create = 新建数据表；append = 追加到已有数据表 */
  importMode: 'create' | 'append'
  /** append 模式下的目标数据表 id */
  importTableId: string
}

export type ParsedFile = {
  fileName: string
  sheets: SourceSheet[]
  warnings: string[]
}

/**
 * 进度明细里的一条。
 * 导入/导出共用的最小结构：`label` + 状态 + 右侧补充信息。
 */
export type StageItem = {
  label: string
  meta?: string
  state: 'done' | 'active' | 'fail' | 'pending'
}

export function cellKey(row: number, col: number): string {
  return `${row}::${col}`
}

export function colLetter(col: number): string {
  let n = col
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}
