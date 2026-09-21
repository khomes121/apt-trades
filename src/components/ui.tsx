'use client';

/**
 * 공용 UI 부품 — 모든 페이지가 이것만 조립해서 쓴다.
 * 색은 globals.css 의 의미 토큰(bg-surface·text-ink·border-line·text-up…)만 쓴다.
 * gray-500·blue-600 같은 팔레트 색을 직접 쓰면 다크 모드에서 깨진다.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
export { cx };

// ── 레이아웃 ────────────────────────────────────────────────────────────────

/** 페이지 본문 폭. 모든 페이지가 같은 좌우 여백을 갖는다. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cx('mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6', className)}>{children}</main>;
}

export function PageHeader({ title, desc, right, eyebrow }: {
  title: string; desc?: ReactNode; right?: ReactNode; eyebrow?: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow && <div className="text-xs font-semibold tracking-wide text-brand mb-1">{eyebrow}</div>}
        <h1 className="text-2xl sm:text-[1.75rem] font-bold tracking-tight text-ink">{title}</h1>
        {desc && <p className="mt-1.5 text-sm text-ink-2">{desc}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('bg-surface border border-line rounded-2xl shadow-card', pad && 'p-5 sm:p-6', className)}>
      {children}
    </section>
  );
}

export function CardTitle({ children, sub, right }: { children: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink">{children}</h2>
        {sub && <p className="text-xs text-ink-3 mt-0.5">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

// ── 버튼·칩 ─────────────────────────────────────────────────────────────────

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
};

export function Button({ variant = 'secondary', size = 'md', className, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 font-semibold rounded-xl transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
        size === 'sm' && 'px-3 py-1.5 text-xs',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'px-7 py-3 text-base',
        variant === 'primary' && 'bg-brand text-brand-ink hover:bg-brand-strong shadow-sm',
        variant === 'secondary' && 'bg-surface text-ink border border-line-strong hover:bg-surface-2',
        variant === 'ghost' && 'text-ink-2 hover:bg-surface-3',
        className,
      )}
    />
  );
}

/** 고르는 칩 (프리셋·필터). active 면 채워진다. */
export function Chip({ active, children, className, size = 'md', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'rounded-full border font-medium transition-colors cursor-pointer whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
        active
          ? 'bg-brand text-brand-ink border-brand'
          : 'bg-surface text-ink-2 border-line-strong hover:border-brand hover:text-brand',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** 둘 중 하나 고르기 (AND/OR, 보기 전환) */
export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: {
  value: T; options: Array<{ value: T; label: ReactNode }>; onChange: (v: T) => void; size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex p-0.5 rounded-xl bg-surface-3 border border-line">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-[0.625rem] font-medium transition-colors cursor-pointer',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
            value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── 표시 ────────────────────────────────────────────────────────────────────

export function Badge({ tone = 'neutral', children, className }: {
  tone?: 'neutral' | 'brand' | 'up' | 'down' | 'ok' | 'warn'; children: ReactNode; className?: string;
}) {
  const tones = {
    neutral: 'bg-surface-3 text-ink-2',
    brand: 'bg-brand-soft text-brand',
    up: 'bg-up-soft text-up',
    down: 'bg-down-soft text-down',
    ok: 'bg-ok-soft text-ok',
    warn: 'bg-warn-soft text-warn',
  } as const;
  return (
    <span className={cx('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  );
}

/** 큰 숫자 한 칸 (KPI) */
export function Stat({ label, value, unit, delta, hint }: {
  label: string; value: ReactNode; unit?: string; delta?: ReactNode; hint?: ReactNode;
}) {
  return (
    <div className="bg-surface border border-line rounded-2xl shadow-card p-4 sm:p-5 min-w-0">
      <div className="text-xs font-medium text-ink-3">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1 flex-wrap">
        <span className="num text-2xl sm:text-[1.7rem] font-bold text-ink leading-none">{value}</span>
        {unit && <span className="text-sm text-ink-2">{unit}</span>}
        {delta && <span className="ml-1 text-xs font-semibold">{delta}</span>}
      </div>
      {hint && <div className="mt-2 text-xs text-ink-3 truncate">{hint}</div>}
    </div>
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 mb-2">
      <span className="text-sm font-semibold text-ink">{children}</span>
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('animate-spin h-4 w-4', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({ title, desc, icon = '🔍' }: { title: string; desc?: ReactNode; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-4">
      <div className="text-3xl mb-3" aria-hidden>{icon}</div>
      <div className="text-sm font-semibold text-ink">{title}</div>
      {desc && <div className="mt-1 text-xs text-ink-3 max-w-sm">{desc}</div>}
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="bg-up-soft text-up border border-up/20 rounded-xl px-4 py-3 text-sm font-medium">
      {children}
    </div>
  );
}

/** 가로로 넘치는 표를 감싼다 — 페이지 전체가 옆으로 밀리지 않게 */
export function TableWrap({ children, maxH }: { children: ReactNode; maxH?: string }) {
  return (
    <div className="overflow-auto rounded-xl border border-line" style={maxH ? { maxHeight: maxH } : undefined}>
      {children}
    </div>
  );
}
