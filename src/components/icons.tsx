/** 极简线性图标集（24×24 stroke），currentColor 取色，无需图标库 */

type P = { size?: number; className?: string }

function base(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  }
}

export function IconUpload({ size = 16, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 17v1.5A2.5 2.5 0 0 0 6.5 21h11A2.5 2.5 0 0 0 20 18.5V17" />
    </svg>
  )
}

export function IconDownload({ size = 16, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 18.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-.5" />
    </svg>
  )
}

export function IconTable({ size = 16, className }: P) {
  return (
    <svg {...base(size, className)}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M3 9.5h18M9 9.5V19.5" />
    </svg>
  )
}

export function IconImage({ size = 16, className }: P) {
  return (
    <svg {...base(size, className)}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m4 17 4.6-4.6a1.5 1.5 0 0 1 2.1 0l3.1 3.1a1.5 1.5 0 0 0 2.1 0L20 12" />
    </svg>
  )
}

export function IconGrid({ size = 16, className }: P) {
  return (
    <svg {...base(size, className)}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M3 9.5h18M3 14.5h18M9 4.5v15" />
    </svg>
  )
}

export function IconCheck({ size = 16, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  )
}

export function IconInfo({ size = 16, className }: P) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.8v.2" />
    </svg>
  )
}

export function IconWarn({ size = 16, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M10.3 4.3 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5V14M12 17.2v.2" />
    </svg>
  )
}

export function IconError({ size = 16, className }: P) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </svg>
  )
}

export function IconRefresh({ size = 16, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M20 11.5A8 8 0 1 0 18.4 16" />
      <path d="M20 5.5v6h-5.6" />
    </svg>
  )
}

export function IconSparkle({ size = 16, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9Z" />
    </svg>
  )
}

export function IconChevron({ size = 16, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="m6 9.5 6 6 6-6" />
    </svg>
  )
}

export function IconFolder({ size = 16, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M3 7.5A2 2 0 0 1 5 5.5h3.6a2 2 0 0 1 1.5.7l1 1.2H19a2 2 0 0 1 2 2v7.1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  )
}

export function IconLink({ size = 16, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M10 13.8a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1.2 1.2" />
      <path d="M14 10.2a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1.2-1.2" />
    </svg>
  )
}

export function IconFeedback({ size = 16, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M20.5 12.4a7.6 7.6 0 0 1-8.2 7.6 8.6 8.6 0 0 1-2.4-.4L4.5 21l1.4-4.3a8 8 0 0 1-.9-3.6 7.4 7.4 0 0 1 6.3-7.3 7.7 7.7 0 0 1 9.2 6.6Z" />
      <path d="M9.4 11.6h5.2M9.4 14.6h3.4" />
    </svg>
  )
}
