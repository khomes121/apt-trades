'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { useFavorites } from '@/lib/favorites';

const TABS = [
  { href: '/',          label: '홈' },
  { href: '/search',    label: '변동 분석' },
  { href: '/daily',     label: '날짜별 실거래' },
  { href: '/trend',     label: '시세 동향' },
  { href: '/villa',     label: '빌라·다세대' },
  { href: '/favorites', label: '관심단지' },
];

function isActive(pathname: string, href: string) {
  const p = pathname.replace(/\/$/, '') || '/';
  return href === '/' ? p === '/' : p === href || p.startsWith(`${href}/`);
}

const THEME_EVT = 'apt-trades:theme';
function subscribeTheme(cb: () => void) {
  window.addEventListener(THEME_EVT, cb);
  return () => window.removeEventListener(THEME_EVT, cb);
}
const readTheme = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

function ThemeToggle() {
  // 테마의 진짜 값은 <html data-theme> 에 있다(첫 그림 전에 layout 의 스크립트가 정한다). 여기선 그걸 읽기만 한다.
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => 'light' as const);
  function flip() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('apt-trades:theme', next); } catch { /* 무시 */ }
    window.dispatchEvent(new Event(THEME_EVT));
  }
  return (
    <button
      onClick={flip}
      aria-label={theme === 'dark' ? '밝은 화면으로' : '어두운 화면으로'}
      title={theme === 'dark' ? '밝은 화면으로' : '어두운 화면으로'}
      className="h-9 w-9 inline-flex items-center justify-center rounded-xl text-ink-2 hover:bg-surface-3 transition-colors cursor-pointer"
    >
      {theme === 'dark' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative h-7 w-7 rounded-lg bg-brand text-brand-ink inline-flex items-center justify-center shadow-sm">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 17l5-5 4 3 8-9" /><path d="M15 6h5v5" />
        </svg>
      </span>
      <span className="text-[0.95rem] font-bold tracking-tight text-ink">실거래 레이더</span>
    </span>
  );
}

export default function GlobalNav() {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const { list } = useFavorites();

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-surface/85 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 h-14 flex items-center gap-4">
        <Link href="/" aria-label="홈으로" className="shrink-0"><Logo /></Link>

        <nav className="hidden md:flex items-center gap-0.5 ml-4" aria-label="주 메뉴">
          {TABS.map(tab => {
            const active = isActive(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`relative px-3 py-2 rounded-lg text-sm transition-colors ${
                  active ? 'text-brand font-semibold' : 'text-ink-2 hover:text-ink hover:bg-surface-3'
                }`}
              >
                {tab.label}
                {tab.href === '/favorites' && list.length > 0 && (
                  <span className="ml-1 num text-[0.65rem] font-bold px-1.5 py-0.5 rounded-full bg-brand-soft text-brand align-middle">{list.length}</span>
                )}
                {active && <span className="absolute left-3 right-3 -bottom-[0.6rem] h-0.5 rounded-full bg-brand" />}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <button
            className="md:hidden h-9 w-9 inline-flex items-center justify-center rounded-xl text-ink-2 hover:bg-surface-3 cursor-pointer"
            aria-label="메뉴" aria-expanded={open} onClick={() => setOpen(o => !o)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav className="md:hidden border-t border-line bg-surface px-3 py-2 grid grid-cols-2 gap-1" aria-label="주 메뉴(모바일)">
          {TABS.map(tab => {
            const active = isActive(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={() => setOpen(false)}
                className={`px-3 py-2.5 rounded-xl text-sm ${active ? 'bg-brand-soft text-brand font-semibold' : 'text-ink-2 hover:bg-surface-3'}`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
