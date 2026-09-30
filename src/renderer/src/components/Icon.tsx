/** The icons of Telegraph: drawn in one hand, 16 by 16, in the colour of the text beside them. */
const PATHS = {
  plus: 'M8 3v10M3 8h10',
  plug: 'M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11v3',
  play: 'M5 3.5v9l7.5-4.5z',
  pause: 'M5 3.5v9M11 3.5v9',
  stop: 'M4.5 4.5h7v7h-7z',
  close: 'M4 4l8 8M12 4l-8 8',
  check: 'M3.5 8.5l3 3 6-7',
  calendar: 'M3 4.5h10v8.5H3zM3 7.5h10M5.5 3v3M10.5 3v3',
  mail: 'M2.5 4h11v8h-11zM2.5 4.5l5.5 4 5.5-4',
  sparkle: 'M8 2.5l1.3 3.7L13 7.5l-3.7 1.3L8 12.5l-1.3-3.7L3 7.5l3.7-1.3z',
  folder: 'M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z',
  terminal: 'M3 4l3.5 3.5L3 11M8 11.5h5'
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const filled = name === 'play' || name === 'stop'
  return (
    <svg className="icon" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path
        d={PATHS[name]}
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
