import { FT, extOf, mimeOfName } from './field-meta'
import { formatDate, parseBool, parseDateMs, parseNumber, rawToText, splitMulti } from './infer'
import type { CellRaw, MediaRef } from './types'

export type ConvertResult = { ok: true; value: unknown } | { ok: false; reason: string }

export type ConvertContext = {
  /** 该单元格上传成功后的附件 */
  media: MediaRef[]
  /**
   * 单选/多选的「选项名 -> 选项 id」映射。
   *
   * 多维表格写单选/多选单元格时，值必须是 { id, text }：
   * 只给纯文本不会报错，但单元格会保持空白（选项建好了却「没有值」）。
   */
  options?: Map<string, string>
}

/**
 * 把 Excel 单元格的原始值转成多维表格能写入的形态。
 * 附件值形如 [{ name, size, type, token, timeStamp }]，与官方 setCellValue 示例一致。
 */
export function toBitableValue(type: number, raw: CellRaw, ctx: ConvertContext): ConvertResult {
  switch (type) {
    case FT.Attachment: {
      if (!ctx.media.length) return { ok: false, reason: '单元格内没有可用的附件' }
      return {
        ok: true,
        value: ctx.media.map((m) => ({
          name: m.name,
          size: m.size,
          type: m.type,
          token: m.token,
          timeStamp: Date.now(),
        })),
      }
    }

    case FT.Text:
      return { ok: true, value: rawToText(raw) }

    case FT.Number: {
      const n = parseNumber(raw)
      if (n === null) return { ok: false, reason: '不是合法数字' }
      return { ok: true, value: n }
    }

    case FT.Checkbox:
      return { ok: true, value: parseBool(raw) }

    case FT.DateTime: {
      const ms = parseDateMs(raw)
      if (ms === null) return { ok: false, reason: '不是合法日期' }
      return { ok: true, value: ms }
    }

    case FT.SingleSelect: {
      const t = rawToText(raw).trim()
      if (!t) return { ok: false, reason: '空值' }
      return { ok: true, value: selectValue(t, ctx.options) }
    }

    case FT.MultiSelect: {
      const arr = splitMulti(raw)
      if (!arr.length) return { ok: false, reason: '空值' }
      return { ok: true, value: arr.map((t) => selectValue(t, ctx.options)) }
    }

    case FT.Phone:
      return { ok: true, value: rawToText(raw).trim() }

    case FT.Email:
      return { ok: true, value: rawToText(raw).trim() }

    case FT.Url: {
      const t = rawToText(raw).trim()
      if (!t) return { ok: false, reason: '空值' }
      // UrlTransformVal = string | IOpenUrlSegment | IOpenUrlSegment[]
      // 传纯字符串最稳（IOpenUrlSegment 必须带 type:'url'，少字段会被拒）
      const link = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`
      return { ok: true, value: link }
    }

    case FT.Currency:
    case FT.Progress:
    case FT.Rating: {
      const n = parseNumber(raw)
      if (n === null) return { ok: false, reason: '不是合法数字' }
      return { ok: true, value: n }
    }

    default:
      return { ok: true, value: rawToText(raw) }
  }
}

/**
 * 把选项文本转成多维表格单选/多选单元格值。
 *
 * 形如 [{ id: 'optXXX', text: '已启用' }]。
 * 为什么必须带 id：多维表格的 setCellValue / addRecords 对单选/多选字段
 * 「不会按名字自动匹配选项」—— 传纯字符串时接口静默忽略，单元格留空，
 * 表现就是「点开字段详情能看到选项都建好了，但那一列什么都没有」。
 * 拿不到 id 时退回纯文本，至少不会把整列丢掉。
 */
function selectValue(text: string, options?: Map<string, string>): { id: string; text: string } | string {
  const id = options?.get(text)
  return id ? { id, text } : text
}

/** 反向：多维表格单元格 -> 写入 Excel 的文本/数字 */
export function bitableValueToExcel(type: number, v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null

  if (type === FT.DateTime || type === FT.CreatedTime || type === FT.ModifiedTime) {
    const ms = typeof v === 'number' ? v : Number(v)
    if (Number.isFinite(ms) && ms > 0) return formatDate(new Date(ms))
    return null
  }
  if (type === FT.Checkbox) return v === true || v === 'true' || v === 1

  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return formatDate(v)

  if (Array.isArray(v)) {
    return v
      .map((item) => {
        if (item === null || item === undefined) return ''
        if (typeof item === 'string' || typeof item === 'number') return String(item)
        if (typeof item === 'object') {
          const o = item as Record<string, unknown>
          return String(o.text ?? o.name ?? o.en_name ?? o.link ?? '')
        }
        return String(item)
      })
      .filter(Boolean)
      .join(', ')
  }

  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('text' in o && 'link' in o) return String(o.text ?? o.link ?? '')
    if ('link' in o) return String(o.link ?? '')
    if ('text' in o) return String(o.text ?? '')
    if ('name' in o) return String(o.name ?? '')
    if ('value' in o) return String(o.value ?? '')
    if ('full_address' in o || 'address' in o) return String(o.full_address ?? o.address ?? '')
  }
  return null
}

/** 从多维表格附件单元格里取出 token / 名称 / 类型 */
export function extractAttachments(v: unknown): { token: string; name: string; size: number; type: string }[] {
  if (!Array.isArray(v)) return []
  return v
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const o = item as Record<string, unknown>
      const token = String(o.token ?? o.file_token ?? '')
      if (!token) return null
      const name = String(o.name ?? `${token}.png`)
      return {
        token,
        name,
        size: Number(o.size ?? 0),
        type: String(o.type ?? mimeOfName(name, 'image/png')),
      }
    })
    .filter((x): x is { token: string; name: string; size: number; type: string } => !!x)
}

export function guessExtFromMime(mime: string, fallbackName?: string): string {
  const m = (mime || '').toLowerCase()
  if (m.includes('png')) return 'png'
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('gif')) return 'gif'
  if (m.includes('webp')) return 'webp'
  if (m.includes('bmp')) return 'bmp'
  if (m.includes('tiff')) return 'tiff'
  if (m.includes('svg')) return 'svg'
  if (fallbackName) {
    const e = extOf(fallbackName)
    if (e) return e
  }
  return 'png'
}
