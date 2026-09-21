'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import TradeDetailModal from '@/components/TradeDetailModal';
import { Badge, Button, Card, EmptyState, Page, PageHeader, Skeleton } from '@/components/ui';
import { favKey, useFavorites, type Favorite } from '@/lib/favorites';
import { formatKDate, formatPrice, formatRate, toPyeong, trendColor } from '@/lib/format';

interface Trade {
  deal_date: string; deal_amount: number; floor: number | null; area_group: number; exclu_use_ar: number;
}
interface Snapshot {
  count: number;
  latest: Trade | null;
  prevSameArea: Trade | null;   // 같은 평형의 직전 거래
  high1y: number | null;
  low1y: number | null;
  series: number[];             // 최근 24건 (같은 평형) 가격 흐름
}

function snapshot(trades: Trade[]): Snapshot {
  const sorted = [...trades].sort((a, b) => a.deal_date.localeCompare(b.deal_date));
  const latest = sorted.at(-1) ?? null;
  if (!latest) return { count: 0, latest: null, prevSameArea: null, high1y: null, low1y: null, series: [] };
  const same = sorted.filter(t => t.area_group === latest.area_group);
  const yearAgo = new Date(); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const cut = yearAgo.toISOString().slice(0, 10);
  const recent = same.filter(t => t.deal_date >= cut).map(t => t.deal_amount);
  return {
    count: sorted.length,
    latest,
    prevSameArea: same.at(-2) ?? null,
    high1y: recent.length ? Math.max(...recent) : null,
    low1y: recent.length ? Math.min(...recent) : null,
    series: same.slice(-24).map(t => t.deal_amount),
  };
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-10" />;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${36 - ((v - min) / span) * 32 - 2}`).join(' ');
  const rising = values[values.length - 1] >= values[0];
  return (
    <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="w-full h-10" aria-hidden>
      <polyline points={pts} fill="none" stroke={rising ? 'var(--up)' : 'var(--down)'} strokeWidth="1.8"
        strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function FavCard({ fav, onOpen, onRemove }: { fav: Favorite; onOpen: () => void; onRemove: () => void }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apt_nm: fav.apt_nm, sgg_cd: fav.sgg_cd }),
    })
      .then(r => r.json())
      .then((j: { results?: Trade[] }) => { if (alive) setSnap(snapshot(j.results ?? [])); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [fav.apt_nm, fav.sgg_cd]);

  const diff = snap?.latest && snap.prevSameArea ? snap.latest.deal_amount - snap.prevSameArea.deal_amount : null;
  const rate = diff != null && snap?.prevSameArea ? (diff / snap.prevSameArea.deal_amount) * 100 : null;

  return (
    <div
      role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className="group text-left bg-surface border border-line rounded-2xl shadow-card p-5 hover:border-brand transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-ink truncate">{fav.apt_nm}</div>
          <div className="text-xs text-ink-3 mt-0.5 truncate">{[fav.region, fav.umd_nm].filter(Boolean).join(' · ')}</div>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          aria-label={`${fav.apt_nm} 관심단지에서 빼기`} title="관심단지에서 빼기"
          className="shrink-0 h-8 w-8 -mr-1 -mt-1 inline-flex items-center justify-center rounded-lg text-warn hover:bg-surface-3 cursor-pointer"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.6 6.1 20.7l1.2-6.6L2.5 9.5l6.6-.9L12 2.5z" /></svg>
        </button>
      </div>

      {failed ? (
        <div className="mt-4 text-xs text-ink-3">거래 내역을 불러오지 못했습니다.</div>
      ) : !snap ? (
        <div className="mt-4 space-y-2"><Skeleton className="h-7 w-32" /><Skeleton className="h-10" /></div>
      ) : !snap.latest ? (
        <div className="mt-4 text-xs text-ink-3">거래 내역이 없습니다.</div>
      ) : (
        <>
          <div className="mt-4 flex items-baseline gap-2 flex-wrap">
            <span className="num text-xl font-bold text-ink">{formatPrice(snap.latest.deal_amount)}</span>
            {diff != null && diff !== 0 && (
              <span className={`num text-xs font-semibold ${trendColor(diff)}`}>
                {diff > 0 ? '▲' : '▼'} {formatPrice(Math.abs(diff))} ({formatRate(rate)})
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-ink-2">
            {formatKDate(snap.latest.deal_date, true)} · {toPyeong(snap.latest.exclu_use_ar)}평 · {snap.latest.floor ?? '-'}층
          </div>
          <div className="mt-3"><Sparkline values={snap.series} /></div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge>누적 {snap.count.toLocaleString()}건</Badge>
            {snap.high1y != null && <Badge tone="up">1년 최고 {formatPrice(snap.high1y)}</Badge>}
            {snap.low1y != null && <Badge tone="down">1년 최저 {formatPrice(snap.low1y)}</Badge>}
          </div>
        </>
      )}
    </div>
  );
}

export default function FavoritesPage() {
  const { list, remove } = useFavorites();
  const [open, setOpen] = useState<Favorite | null>(null);
  // 서버에서 만든 첫 HTML 에는 목록이 없다(브라우저 저장소라서) → 브라우저에 붙은 뒤에만 목록을 그린다
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  const sorted = useMemo(() => [...list].sort((a, b) => b.addedAt.localeCompare(a.addedAt)), [list]);

  return (
    <Page>
      <PageHeader
        eyebrow="내 목록"
        title="관심단지"
        desc="별표를 누른 단지의 최근 거래가와 흐름을 한 화면에서 봅니다. 목록은 이 브라우저에만 저장됩니다."
        right={<Link href="/search"><Button variant="primary">단지 찾으러 가기</Button></Link>}
      />

      {!mounted ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-52 !rounded-2xl" />)}
        </div>
      ) : sorted.length === 0 ? (
        <Card>
          <EmptyState
            icon="⭐"
            title="아직 담아 둔 단지가 없습니다"
            desc="변동 분석이나 날짜별 실거래의 결과 목록에서 별표를 누르면 여기에 모입니다. 단지 상세 창의 별표로도 담을 수 있습니다."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map(f => (
            <FavCard key={favKey(f.apt_nm, f.sgg_cd)} fav={f}
              onOpen={() => setOpen(f)} onRemove={() => remove(f.apt_nm, f.sgg_cd)} />
          ))}
        </div>
      )}

      {open && (
        <TradeDetailModal
          aptNm={open.apt_nm} sggCd={open.sgg_cd} sggName={open.region ?? ''} umdNm={open.umd_nm ?? ''}
          onClose={() => setOpen(null)}
        />
      )}
    </Page>
  );
}
