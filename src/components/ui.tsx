import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { IconCheck, IconError, IconInfo, IconWarn } from './icons'

/* ------------------------------- 卡片 ------------------------------- */

export function Card({
  title,
  hint,
  extra,
  children,
  flush,
}: {
  title?: ReactNode
  hint?: ReactNode
  extra?: ReactNode
  children: ReactNode
  flush?: boolean
}) {
  return (
    <section className="card">
      {(title || extra) && (
        <header className="card-head">
          <div className="card-head-main">
            {title && <h3 className="card-title">{title}</h3>}
            {hint && <p className="card-hint">{hint}</p>}
          </div>
          {extra && <div className="card-head-extra">{extra}</div>}
        </header>
      )}
      <div className={flush ? 'card-body flush' : 'card-body'}>{children}</div>
    </section>
  )
}

/* ------------------------------- 提示条 ------------------------------- */

type NoticeKind = 'info' | 'ok' | 'warn' | 'err'

export function Notice({ kind = 'info', children }: { kind?: NoticeKind; children: ReactNode }) {
  const Icon = kind === 'ok' ? IconCheck : kind === 'warn' ? IconWarn : kind === 'err' ? IconError : IconInfo
  return (
    <div className={`notice ${kind}`}>
      <span className="notice-icon">
        <Icon size={15} />
      </span>
      <div className="notice-text">{children}</div>
    </div>
  )
}

/* ------------------------------- 进度条 ------------------------------- */

/**
 * 进度条。
 * - 只在 `done/total` 有值时按比例推进；`indeterminate` 时走流光（不确定总量）。
 * - `tone='export'` 换一套配色，让导出进度和导入明显区分。
 */
export function Progress({
  done,
  total,
  label,
  detail,
  tone = 'import',
  indeterminate,
}: {
  done: number
  total: number
  label?: ReactNode
  detail?: ReactNode
  tone?: 'import' | 'export'
  indeterminate?: boolean
}) {
  const safeTotal = Math.max(1, total)
  const pct = Math.max(0, Math.min(100, Math.round((done / safeTotal) * 100)))
  const spinning = indeterminate || pct === 0
  return (
    <div className={`prog prog-${tone}${spinning ? ' spinning' : ''}`}>
      <div className="prog-top">
        <span className="prog-label">{label ?? '处理中'}</span>
        <span className="prog-pct">{Math.round(pct)}%</span>
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${pct}%`}
      >
        <div className="progress-fill" style={{ width: `${Math.max(pct, 3)}%` }}>
          <span className="progress-gloss" aria-hidden />
        </div>
      </div>
      <div className="prog-foot">
        <span className="prog-count">
          <span className="prog-num">{done}</span>
          <span className="prog-sep">/</span>
          <span>{total || '—'}</span>
        </span>
        {detail && <span className="prog-detail">{detail}</span>}
      </div>
    </div>
  )
}

/* ------------------------------ 分段控件 ------------------------------ */

export type SegmentOption<T extends string> = {
  value: T
  label: ReactNode
  icon?: ReactNode
  tip?: string
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: T
  options: SegmentOption<T>[]
  onChange: (v: T) => void
  disabled?: boolean
  ariaLabel?: string
}) {
  return (
    <div className={`segmented${disabled ? ' disabled' : ''}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'seg active' : 'seg'}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <span className="seg-icon">{o.icon}</span>}
          <span className="seg-label">{o.label}</span>
          {o.tip && (
            <Tip text={o.tip}>
              <span className="seg-tip">?</span>
            </Tip>
          )}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------- 弹层（下拉） ------------------------------- */
/* 同样用 fixed 定位，避免被侧边栏滚动容器裁切；点击外部 / Esc 关闭 */

export function Popover({
  trigger,
  children,
  disabled,
  ariaLabel,
}: {
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode
  children: (p: { close: () => void }) => ReactNode
  disabled?: boolean
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const panelRef = useRef<HTMLSpanElement | null>(null)

  const place = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // 面板宽度在 CSS 里定死，这里按它居中并对视口做收边，防止溢出屏幕
    const PANEL_W = 268
    const half = PANEL_W / 2
    const vw = window.innerWidth || document.documentElement.clientWidth || PANEL_W + 16
    const center = r.left + r.width / 2
    const x = Math.min(Math.max(Number.isFinite(center) ? center : vw / 2, half + 8), vw - half - 8)
    const y = Number.isFinite(r.bottom) ? r.bottom : 0
    setPos({ x, y })
  }, [])

  useEffect(() => {
    if (!open) return
    place()
    const onScrollOrResize = () => place()
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node | null
      if (!t) return
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    document.addEventListener('mousedown', onDocDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
      document.removeEventListener('mousedown', onDocDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, place])

  return (
    <>
      <span ref={anchorRef} className="pop-anchor">
        {trigger({
          open,
          toggle: () => {
            if (disabled) return
            if (!open) place()
            setOpen((v) => !v)
          },
        })}
      </span>
      {open && !disabled && (
        <span
          ref={panelRef}
          role="dialog"
          aria-label={ariaLabel}
          className="pop-panel"
          style={{ left: pos.x, top: pos.y }}
        >
          {children({ close: () => setOpen(false) })}
        </span>
      )}
    </>
  )
}

/* ------------------------------- 悬浮提示 ------------------------------- */
/* 用 fixed 定位挂到视口，避免被侧边栏滚动容器裁切 */

export function Tip({
  text,
  children,
  side = 'top',
}: {
  text: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom'
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const id = useId()

  const place = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = side === 'top' ? r.top : r.bottom
    setPos({
      x: Number.isFinite(x) ? x : (window.innerWidth || 0) / 2,
      y: Number.isFinite(y) ? y : 0,
    })
  }, [side])

  useEffect(() => {
    if (!open) return
    place()
    const onMove = () => place()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, place])

  return (
    <>
      <span
        ref={anchorRef}
        className="tip-anchor"
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => {
          place()
          setOpen(true)
        }}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => {
          place()
          setOpen(true)
        }}
        onBlur={() => setOpen(false)}
      >
        {children}
      </span>
      {open && (
        <span id={id} role="tooltip" className={`tip-bubble ${side}`} style={{ left: pos.x, top: pos.y }}>
          {text}
        </span>
      )}
    </>
  )
}
