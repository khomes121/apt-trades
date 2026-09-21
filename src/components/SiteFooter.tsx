'use client';

import { useEffect, useState } from 'react';
import { formatUtcToKst } from '@/lib/format';

interface Health {
  apt?: { lastCollectedAt?: string; latestDealDate?: string };
  villa?: { lastCollectedAt?: string; latestDealDate?: string };
}

/** 마지막 적재가 30시간을 넘겼으면 '지연' 으로 본다 (수집은 하루 한 번 새벽에 돈다) */
function isFresh(utc?: string) {
  if (!utc) return false;
  const t = new Date(`${utc.replace(' ', 'T')}Z`).getTime();
  return Date.now() - t < 30 * 3600e3;
}

export default function SiteFooter() {
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    fetch('/api/health').then(r => (r.ok ? r.json() : null)).then(setH).catch(() => setH(null));
  }, []);

  const rows: Array<[string, Health['apt']]> = [['아파트', h?.apt], ['빌라', h?.villa]];

  return (
    <footer className="mt-10 border-t border-line bg-surface">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 text-xs text-ink-3">
        <div>
          자료: 국토교통부 실거래가 공개시스템 · 매일 새벽 자동 수집
          <span className="hidden sm:inline"> · 신고 기한(계약 후 30일) 때문에 최근 거래는 뒤늦게 반영될 수 있습니다</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {h && rows.map(([name, s]) => (
            <span key={name} className="inline-flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${isFresh(s?.lastCollectedAt) ? 'bg-ok' : 'bg-warn'}`} />
              {name} 적재 {formatUtcToKst(s?.lastCollectedAt)}
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
}
