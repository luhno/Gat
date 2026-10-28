// Inline SVG icons — no external assets, no icon font (the app must work fully offline).

import type { ReactNode } from "react"

interface IconProps {
  className?: string
}

const svg = (props: IconProps, children: ReactNode) => (
  <svg
    className={props.className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
)

export const IconMic = (props: IconProps) =>
  svg(
    props,
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>,
  )

export const IconMicOff = (props: IconProps) =>
  svg(
    props,
    <>
      <path d="M9 5.5A3 3 0 0 1 15 6v5M9 10v1a3 3 0 0 0 4.6 2.6" />
      <path d="M5 11a7 7 0 0 0 11 5.7M12 18v3M4 4l16 16" />
    </>,
  )

export const IconCamera = (props: IconProps) =>
  svg(
    props,
    <>
      <rect x="3" y="6" width="12" height="12" rx="2.5" />
      <path d="M15 10.5 21 7v10l-6-3.5" />
    </>,
  )

export const IconCameraOff = (props: IconProps) =>
  svg(
    props,
    <>
      <path d="M15 8.5A2.5 2.5 0 0 0 12.5 6H5.5A2.5 2.5 0 0 0 3 8.5v7A2.5 2.5 0 0 0 5.5 18h7a2.5 2.5 0 0 0 2.5-2.5M21 7v10l-4-2.3M4 4l16 16" />
    </>,
  )

export const IconScreen = (props: IconProps) =>
  svg(
    props,
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M12 16v4M8 20h8M8.5 11l2.5-2.5L13.5 11" />
    </>,
  )

export const IconChat = (props: IconProps) =>
  svg(props, <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4z" />)

export const IconPeople = (props: IconProps) =>
  svg(
    props,
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5.8M17.5 14.3a5.2 5.2 0 0 1 3 4.2" />
    </>,
  )

export const IconGear = (props: IconProps) =>
  svg(
    props,
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.8v2.4M12 18.8v2.4M4.8 12H2.4M21.6 12h-2.4M6.9 6.9 5.2 5.2M18.8 18.8l-1.7-1.7M6.9 17.1l-1.7 1.7M18.8 5.2l-1.7 1.7" />
    </>,
  )

export const IconLeave = (props: IconProps) =>
  svg(
    props,
    <>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 8l-4 4 4 4M6 12h9" />
    </>,
  )

export const IconSend = (props: IconProps) => svg(props, <path d="M4 12 20 4l-7 16-2.2-6.2z" />)

export const IconClose = (props: IconProps) => svg(props, <path d="M6 6l12 12M18 6 6 18" />)

export const IconCopy = (props: IconProps) =>
  svg(
    props,
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </>,
  )
