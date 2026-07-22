import type { CSSProperties } from "react";

interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/** Set de iconos en línea (sin dependencias externas ni emojis). */

export function IconChart({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <path d="M4 20V10M12 20V4M20 20v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconPlug({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <path
        d="M9 3v4M15 3v4M6 7h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V7ZM12 16v5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconChat({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <path
        d="M4 5h16v11H8l-4 4V5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconFolder({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <path
        d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconFile({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <path
        d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM14 3v5h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconWarning({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <path
        d="M12 3 2 20h20L12 3ZM12 10v4M12 17h.01"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconCheck({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="m8 12.5 2.5 2.5L16 9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconCalendar({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconLogout({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <path
        d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconDownload({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <path
        d="M12 3v12m0 0 5-5m-5 5-5-5M4 20h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconWhatsApp({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <path
        d="M12 3a9 9 0 0 0-7.75 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 9c0-.5.5-1.5 1-1.5s1 1.5 1.3 2 .6 1 .2 1.5-.9.7-.6 1.3S11.5 14 12.5 14.5s1-.8 1.5-1.1 1 0 1.5.4.9.9.5 1.4-1.3 1.3-2.4 1.2c-1.1-.1-3.4-1.3-4.4-3.1C8.2 11.7 8.5 9.5 8.5 9Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function IconUsers({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <path
        d="M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM17 4.5a3.5 3.5 0 0 1 0 6.9M21 20v-1a4 4 0 0 0-3-3.85"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconPercent({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <path d="M19 5 5 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="7" cy="7" r="2.2" stroke="currentColor" strokeWidth="2" />
      <circle cx="17" cy="17" r="2.2" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function IconPanelLeft({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M9 4v16" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function IconCopy({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconKey({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <circle cx="8" cy="15" r="4" stroke="currentColor" strokeWidth="2" />
      <path d="M11 12 20 3m0 0h-4m4 0v4M14.5 8.5 17 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconMail({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSparkles({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <path
        d="M11 3v4M11 3l1.5 3.5L16 8l-3.5 1.5L11 13l-1.5-3.5L6 8l3.5-1.5L11 3ZM18 14v3M18 14l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
