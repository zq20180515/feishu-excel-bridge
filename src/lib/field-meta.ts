/**
 * 字段类型常量。
 * 直接用开放平台文档里的数值，避免依赖 SDK 枚举成员名在不同版本间的差异。
 * 参考：Base JS SDK - FieldType 枚举
 */
export const FT = {
  Text: 1,
  Number: 2,
  SingleSelect: 3,
  MultiSelect: 4,
  DateTime: 5,
  Checkbox: 7,
  User: 11,
  Phone: 13,
  Url: 15,
  Attachment: 17,
  SingleLink: 18,
  Lookup: 19,
  Formula: 20,
  DuplexLink: 21,
  Location: 22,
  GroupChat: 23,
  CreatedTime: 1001,
  ModifiedTime: 1002,
  CreatedUser: 1003,
  ModifiedUser: 1004,
  AutoNumber: 1005,
  Barcode: 99001,
  Progress: 99002,
  Currency: 99003,
  Rating: 99004,
  Email: 99005,
} as const

const LABELS: Record<number, string> = {
  [FT.Text]: '多行文本',
  [FT.Number]: '数字',
  [FT.SingleSelect]: '单选',
  [FT.MultiSelect]: '多选',
  [FT.DateTime]: '日期',
  [FT.Checkbox]: '复选框',
  [FT.User]: '人员',
  [FT.Phone]: '电话',
  [FT.Url]: '超链接',
  [FT.Attachment]: '附件',
  [FT.SingleLink]: '单向关联',
  [FT.Lookup]: '查找引用',
  [FT.Formula]: '公式',
  [FT.DuplexLink]: '双向关联',
  [FT.Location]: '地理位置',
  [FT.GroupChat]: '群聊',
  [FT.CreatedTime]: '创建时间',
  [FT.ModifiedTime]: '修改时间',
  [FT.CreatedUser]: '创建人',
  [FT.ModifiedUser]: '修改人',
  [FT.AutoNumber]: '自动编号',
  [FT.Barcode]: '二维码',
  [FT.Progress]: '进度',
  [FT.Currency]: '货币',
  [FT.Rating]: '评分',
  [FT.Email]: '邮箱',
}

export function fieldTypeLabel(type: number): string {
  return LABELS[type] ?? `未知(${type})`
}

/**
 * 字段类型的色块主题名。
 * 映射区用「字段名 → 类型」两段式，靠色块区分类型，比文字更快扫读。
 * 命名与 styles.css 里的 .tk-* 一一对应。
 */
export function fieldTypeTone(type: number): string {
  switch (type) {
    // 文本族 —— 灰
    case FT.Text:
      return 'text'
    // 数字族 —— 蓝
    case FT.Number:
    case FT.Currency:
    case FT.Progress:
    case FT.Rating:
      return 'num'
    // 选择族 —— 紫
    case FT.SingleSelect:
    case FT.MultiSelect:
      return 'select'
    // 时间族 —— 橙
    case FT.DateTime:
    case FT.CreatedTime:
    case FT.ModifiedTime:
      return 'time'
    // 布尔 —— 青
    case FT.Checkbox:
      return 'bool'
    // 附件 —— 主色（青绿）
    case FT.Attachment:
      return 'attach'
    // 联系方式 —— 绿
    case FT.Phone:
    case FT.Email:
      return 'contact'
    // 链接 —— 靛
    case FT.Url:
      return 'link'
    default:
      return 'other'
  }
}

/** 允许在导入映射界面里被选中的目标字段类型 */
export const IMPORTABLE_TYPES: { value: number; label: string }[] = [
  { value: FT.Text, label: '多行文本' },
  { value: FT.Number, label: '数字' },
  { value: FT.SingleSelect, label: '单选' },
  { value: FT.MultiSelect, label: '多选' },
  { value: FT.DateTime, label: '日期' },
  { value: FT.Checkbox, label: '复选框' },
  { value: FT.Phone, label: '电话' },
  { value: FT.Url, label: '超链接' },
  { value: FT.Email, label: '邮箱' },
  { value: FT.Attachment, label: '附件' },
]

/** 这些字段类型不支持写入（自动编号 / 公式 / 关联 / 查找等等） */
export const READONLY_TYPES = new Set<number>([
  FT.SingleLink,
  FT.Lookup,
  FT.Formula,
  FT.DuplexLink,
  FT.GroupChat,
  FT.CreatedTime,
  FT.ModifiedTime,
  FT.CreatedUser,
  FT.ModifiedUser,
  FT.AutoNumber,
  FT.User,
  FT.Location,
  FT.Barcode,
  FT.Rating,
  FT.Progress,
])

export function isImageMime(mime: string): boolean {
  return /^image\//i.test(mime || '')
}

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  ico: 'image/x-icon',
  emf: 'image/emf',
  wmf: 'image/wmf',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
  txt: 'text/plain',
}

export function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name || '')
  return m ? m[1].toLowerCase() : ''
}

export function mimeOfName(name: string, fallback = 'application/octet-stream'): string {
  return EXT_MIME[extOf(name)] || fallback
}

/** 图片扩展名 -> excel 内可识别的扩展名（jpeg 统一写 jpg） */
export function normalizeImageExt(ext: string): string {
  const e = (ext || '').toLowerCase()
  if (e === 'jpeg' || e === 'jpe') return 'jpg'
  if (e === 'tif') return 'tiff'
  return e || 'png'
}

/* ---------------------------- 可导入的表格文件类型 ---------------------------- */

export type ImportableFileType = {
  /** 小写扩展名，不带点 */
  ext: string
  label: string
  /** 是否是 zip 容器（只有 zip 容器里才可能有图片附件） */
  zip: boolean
  /** 一句说明，用于 UI 提示与警告文案 */
  note: string
}

/**
 * SheetJS 能读的表格格式。zip = true 的那些才有 xl/media 与 drawing，能解析出图片；
 * 其余格式（xls / xlsb / csv / txt / ods）只能拿到单元格文本。
 */
export const IMPORTABLE_FILE_TYPES: ImportableFileType[] = [
  { ext: 'xlsx', label: 'Excel 工作簿', zip: true, note: '完整支持，图片/附件可解析' },
  { ext: 'xlsm', label: 'Excel 启用宏的工作簿', zip: true, note: '完整支持，图片/附件可解析' },
  { ext: 'xltx', label: 'Excel 模板', zip: true, note: '完整支持，图片/附件可解析' },
  { ext: 'xltm', label: 'Excel 启用宏的模板', zip: true, note: '完整支持，图片/附件可解析' },
  { ext: 'xlam', label: 'Excel 加载宏', zip: true, note: '完整支持，图片/附件可解析' },
  { ext: 'xls', label: 'Excel 97-2003 工作簿', zip: false, note: '可读单元格，但图片无法解析' },
  { ext: 'xlsb', label: 'Excel 二进制工作簿', zip: false, note: '可读单元格，但图片无法解析' },
  { ext: 'ods', label: 'OpenDocument 电子表格', zip: false, note: '可读单元格，但图片无法解析' },
  { ext: 'csv', label: 'CSV 逗号分隔文本', zip: false, note: '纯文本，无图片' },
  { ext: 'txt', label: '制表符分隔文本', zip: false, note: '纯文本，无图片' },
]

/** 文件选择框的 accept 值 */
export const IMPORT_ACCEPT = IMPORTABLE_FILE_TYPES.map((t) => `.${t.ext}`).join(',')

/** 该扩展名的文件类型描述；未知返回 null */
export function lookupFileType(nameOrExt: string): ImportableFileType | null {
  const ext = nameOrExt.includes('.') ? extOf(nameOrExt) : nameOrExt.replace(/^\./, '').toLowerCase()
  if (!ext) return null
  return IMPORTABLE_FILE_TYPES.find((t) => t.ext === ext) ?? null
}

/** 这个文件名能不能解析出图片附件（只有 zip 容器可以） */
export function canExtractMedia(nameOrExt: string): boolean {
  const t = lookupFileType(nameOrExt)
  return !!t && t.zip
}
