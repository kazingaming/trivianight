import { type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/* --- Icons ------------------------------------------------------------ */

type IconProps = { size?: number; className?: string };

const svg = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const IconSound = ({ size = 20 }: IconProps) => (
  <svg {...svg(size)}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
);

export const IconMuted = ({ size = 20 }: IconProps) => (
  <svg {...svg(size)}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    <path d="m16 9 5 6M21 9l-5 6" />
  </svg>
);

export const IconSettings = ({ size = 20 }: IconProps) => (
  <svg {...svg(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.9 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.9H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9.4A1.6 1.6 0 0 0 10.5 4V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.4 1h.1a2 2 0 1 1 0 4H21a1.6 1.6 0 0 0-1.5 1Z" />
  </svg>
);

export const IconCalculator = ({ size = 20 }: IconProps) => (
  <svg {...svg(size)}>
    <rect x="4" y="2" width="16" height="20" rx="2.5" />
    <path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15v4M8 19h4" />
  </svg>
);

export const IconUp = ({ size = 18 }: IconProps) => (
  <svg {...svg(size)}>
    <path d="m6 15 6-6 6 6" />
  </svg>
);

export const IconDown = ({ size = 18 }: IconProps) => (
  <svg {...svg(size)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const IconCheck = ({ size = 18 }: IconProps) => (
  <svg {...svg(size)}>
    <path d="m4 12 5 5L20 6" />
  </svg>
);

export const IconCopy = ({ size = 18 }: IconProps) => (
  <svg {...svg(size)}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);

/**
 * The brand mark. A raster asset rather than inline SVG, so the artwork can be
 * replaced by dropping a new file in `public/` without touching a component.
 */
export const Logo = ({ size = 26 }: IconProps) => (
  <img
    src="/logo.png"
    width={size}
    height={size}
    alt=""
    aria-hidden
    className="topbar__mark"
    decoding="async"
  />
);

/* --- Avatar ------------------------------------------------------------ */

export function Avatar({ name, color, size = 36 }: { name: string; color: number; size?: number }) {
  const initials = name.trim().slice(0, 2).toUpperCase() || '??';
  return (
    <span
      className="result__avatar"
      data-color={color}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/* --- Segmented control -------------------------------------------------- */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  block,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
  block?: boolean;
}) {
  return (
    <div
      className={block ? 'segmented segmented--block' : 'segmented'}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className="segmented__option"
          title={option.hint}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* --- Banner ------------------------------------------------------------- */

export function Banner({
  tone = 'warn',
  children,
}: {
  tone?: 'warn' | 'error';
  children: ReactNode;
}) {
  return (
    <div className={tone === 'error' ? 'banner banner--error' : 'banner'} role="status">
      {children}
    </div>
  );
}

/* --- Toasts -------------------------------------------------------------- */

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
}

export function ToastLayer({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toast-layer" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            className={`toast toast--${toast.tone}`}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {toast.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* --- Misc ---------------------------------------------------------------- */

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="stat" title={hint}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
    </div>
  );
}

export function Lives({ lives, max }: { lives: number; max: number }) {
  return (
    <div className="lives" role="img" aria-label={`${lives} of ${max} lives remaining`}>
      {Array.from({ length: max }, (_, index) => (
        <span
          key={index}
          className={`life ${index < lives ? 'life--full' : 'life--lost'}`}
        />
      ))}
    </div>
  );
}
