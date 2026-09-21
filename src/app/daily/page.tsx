'use client';

/**
 * 날짜별 실거래 — 하루치 아파트 거래를 지역별로 묶어 본다.
 * 데이터는 /api/daily-trades (읽기 전용) 에서만 받는다.
 * 날짜는 주소(?date=YYYY-MM-DD)와 맞춰 둔다 — 홈의 일별 막대가 이 주소로 들어온다.
 */
import { Suspense, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import TradeDetailModal from '@/components/TradeDetailModal';
import {
  Badge, Button, Card, CardTitle, Chip, EmptyState, ErrorBox, Page, PageHeader, Skeleton, Stat, TableWrap, cx,
} from '@/components/ui';
import { useFavorites } from '@/lib/favorites';
import { formatEok, formatKDate, formatPrice, formatShortDate, toPyeong, toYmd } from '@/lib/format';

// ── 타입 ────────────────────────────────────────────────────────────────────

interface SummaryRow {
  sgg_cd: string;
  sgg_nm: string | null;
  sido_nm: string | null;
  sido_cd: string | null;
  trade_count: number;
  avg_eok: number;
  min_eok: number;
  max_eok: number;
}

interface TradeRow {
  apt_nm: string;
  apt_dong: string | null;
  umd_nm: string | null;
  sgg_cd: string;
  sgg_nm: string | null;
  exclu_use_ar: number;
  area_group: number;
  floor: number | null;
  deal_amount: number;
  dealing_gbn: string | null;
  build_year: number | null;
}

interface DailyData { date: string; summary: SummaryRow[]; trades: TradeRow[]; total: number }
type FetchResult = { key: string; data?: DailyData; error?: string };

type SortKey = 'deal_amount' | 'exclu_use_ar' | 'apt_nm' | 'floor' | 'build_year';
type SortDir = 'asc' | 'desc';
type PriceBand = 'all' | 'u5' | '5to10' | '10to20' | 'o20';

// ── 상수 ────────────────────────────────────────────────────────────────────

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 200;       // 한 번에 그리는 행 수 — 5,000행을 한꺼번에 그리면 화면이 멈춘다
const SGG_PREVIEW = 12;      // 전국 보기에서 먼저 보여 주는 구·군 수
const API_ROW_CAP = 5000;    // /api/daily-trades 가 돌려주는 목록 상한
const SIDO_PRIORITY = ['26', '48', '31']; // 부산 → 경남 → 울산 → 나머지는 코드순

const PRICE_BANDS: Array<{ value: PriceBand; label: string; test: (manwon: number) => boolean }> = [
  { value: 'all', label: '전체', test: () => true },
  { value: 'u5', label: '5억 이하', test: a => a <= 50000 },
  { value: '5to10', label: '5~10억', test: a => a > 50000 && a < 100000 },
  { value: '10to20', label: '10~20억', test: a => a >= 100000 && a < 200000 },
  { value: 'o20', label: '20억 이상', test: a => a >= 200000 },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'deal_amount', label: '거래가' },
  { value: 'exclu_use_ar', label: '전용면적' },
  { value: 'floor', label: '층' },
  { value: 'build_year', label: '건축년도' },
  { value: 'apt_nm', label: '단지명' },
];

// ── 도우미 ──────────────────────────────────────────────────────────────────

function parseYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00`);
}

function shiftDate(ymd: string, delta: number): string {
  const d = parseYmd(ymd);
  d.setDate(d.getDate() + delta);
  return toYmd(d);
}

function dayDiff(a: string, b: string): number {
  return Math.round((parseYmd(a).getTime() - parseYmd(b).getTime()) / 86400e3);
}

function dow(ymd: string): string {
  return '일월화수목금토'[parseYmd(ymd).getDay()] ?? '';
}

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, '');
}

/** 억(소수) → 만원. 요약 API 가 억 단위로 주기 때문에 표기 함수에 넣기 전에 되돌린다. */
function eokToManwon(eok: number): number {
  return Math.round(eok * 10000);
}

const MOBILE_MQ = '(max-width: 767px)';
function subscribeMobile(cb: () => void) {
  const m = window.matchMedia(MOBILE_MQ);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
}
/** 좁은 화면이면 표 대신 카드 목록을 그린다 (둘 다 그리면 행이 두 배가 된다). */
function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeMobile, () => window.matchMedia(MOBILE_MQ).matches, () => false);
}

// ── 작은 부품 ───────────────────────────────────────────────────────────────

function StarButton({ active, onToggle, label }: { active: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? `${label} 관심단지에서 빼기` : `${label} 관심단지에 담기`}
      title={active ? '관심단지에서 빼기' : '관심단지에 담기'}
      onClick={e => { e.stopPropagation(); onToggle(); }}
      onKeyDown={e => e.stopPropagation()}
      className={cx(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors cursor-pointer',
        active ? 'text-warn hover:bg-warn-soft' : 'text-ink-3 hover:text-warn hover:bg-surface-3',
      )}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor"
        strokeWidth="2" strokeLinejoin="round" aria-hidden>
        <path d="M12 3.5l2.7 5.5 6 .9-4.35 4.25 1.03 6-5.38-2.83-5.38 2.83 1.03-6L3.3 9.9l6-.9L12 3.5z" />
      </svg>
    </button>
  );
}

function SortTh({ label, k, sortKey, sortDir, onSort, right }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void; right?: boolean;
}) {
  const on = sortKey === k;
  return (
    <th className={right ? '!text-right' : undefined} aria-sort={on ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cx('inline-flex items-center gap-1 font-semibold cursor-pointer hover:text-brand transition-colors', on && 'text-brand')}
      >
        {label}
        <span className={cx('num text-[0.7rem]', on ? 'text-brand' : 'text-ink-3')} aria-hidden>
          {on ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
        </span>
      </button>
    </th>
  );
}

function DealType({ gbn }: { gbn: string | null }) {
  return gbn === '직거래' ? <Badge tone="warn">직거래</Badge> : <Badge>{gbn ?? '중개거래'}</Badge>;
}

function LoadingBody() {
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[6.5rem] !rounded-2xl" />)}
      </div>
      <Skeleton className="h-44 !rounded-2xl" />
      <Skeleton className="h-96 !rounded-2xl" />
    </>
  );
}

const HEADER = (
  <PageHeader
    eyebrow="아파트"
    title="날짜별 실거래"
    desc="날짜를 고르면 그날 계약된 아파트 거래를 지역별로 묶어 보여 드립니다. 해제된 거래는 빼고 셉니다."
  />
);

// ── 페이지 ──────────────────────────────────────────────────────────────────

export default function DailyPage() {
  // 정적 빌드에서는 useSearchParams() 를 쓰는 부분을 Suspense 로 감싸야 한다.
  return (
    <Suspense fallback={<Page>{HEADER}<Skeleton className="h-28 !rounded-2xl" /><LoadingBody /></Page>}>
      <DailyInner />
    </Suspense>
  );
}

function DailyInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const fav = useFavorites();

  const urlDateRaw = searchParams.get('date');
  const urlDate = urlDateRaw && YMD.test(urlDateRaw) && !isNaN(parseYmd(urlDateRaw).getTime()) ? urlDateRaw : null;

  const [latestDate, setLatestDate] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);   // 이 화면에서 고른 날짜 (주소보다 우선)
  const [result, setResult] = useState<FetchResult | null>(null);
  const [retry, setRetry] = useState(0);

  const [selectedSido, setSelectedSido] = useState<string | null>(null);
  const [selectedSgg, setSelectedSgg] = useState<string | null>(null);
  const [showAllSgg, setShowAllSgg] = useState(false);
  const [q, setQ] = useState('');
  const [band, setBand] = useState<PriceBand>('all');
  const [sortKey, setSortKey] = useState<SortKey>('deal_amount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [limitState, setLimitState] = useState<{ key: string; limit: number }>({ key: '', limit: PAGE_SIZE });
  const [detail, setDetail] = useState<TradeRow | null>(null);

  const date = picked ?? urlDate ?? latestDate ?? '';
  const fetchKey = `${date}#${retry}`;

  // 가장 최근 거래일
  useEffect(() => {
    let alive = true;
    fetch('/api/daily-trades')
      .then(r => r.json())
      .then((d: { latestDate?: string | null }) => {
        if (!alive) return;
        setLatestDate(d.latestDate && YMD.test(d.latestDate) ? d.latestDate : toYmd(new Date()));
      })
      .catch(() => { if (alive) setLatestDate(toYmd(new Date())); });
    return () => { alive = false; };
  }, []);

  // 그날의 거래
  useEffect(() => {
    if (!date) return;
    let alive = true;
    const key = `${date}#${retry}`;
    fetch(`/api/daily-trades?date=${date}`)
      .then(r => r.json())
      .then((d: Partial<DailyData> & { error?: string }) => {
        if (!alive) return;
        if (d.error) throw new Error(d.error);
        setResult({
          key,
          data: { date, summary: d.summary ?? [], trades: d.trades ?? [], total: d.total ?? 0 },
        });
      })
      .catch(() => { if (alive) setResult({ key, error: '거래 자료를 불러오지 못했습니다.' }); });
    return () => { alive = false; };
  }, [date, retry]);

  const ready = result?.key === fetchKey ? result : null;
  const loading = !date || !ready;
  const data = ready?.data ?? null;
  const loadError = ready?.error ?? null;

  function changeDate(next: string) {
    if (!YMD.test(next) || next === date) return;
    setPicked(next);
    router.replace(`${pathname}?date=${next}`, { scroll: false });
  }

  const canGoNext = !!date && (!latestDate || date < latestDate);

  // ← → 로 날짜 이동 (입력칸에 있을 때와 상세 창이 열려 있을 때는 빼고)
  useEffect(() => {
    if (!date || detail) return;
    function onKey(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (e.key === 'ArrowRight' && latestDate && date >= latestDate) return;
      e.preventDefault();
      const next = shiftDate(date, e.key === 'ArrowLeft' ? -1 : 1);
      setPicked(next);
      router.replace(`${pathname}?date=${next}`, { scroll: false });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [date, detail, latestDate, pathname, router]);

  const quickDates = useMemo(
    () => (latestDate ? Array.from({ length: 7 }, (_, i) => shiftDate(latestDate, i - 6)) : []),
    [latestDate],
  );

  // ── 지역 묶기 ────────────────────────────────────────────────────────────

  const summary = useMemo(() => data?.summary ?? [], [data]);
  const trades = useMemo(() => data?.trades ?? [], [data]);

  // 시·도별 묶음 (고정 순서: 부산 → 경남 → 울산 → 나머지 코드순)
  const sidoGroups = useMemo(() => {
    const map = new Map<string, { sido_cd: string; sido_nm: string; total: number; sggs: SummaryRow[] }>();
    for (const r of summary) {
      const key = r.sido_cd ?? 'unknown';
      let g = map.get(key);
      if (!g) {
        g = { sido_cd: key, sido_nm: r.sido_nm ?? '미분류', total: 0, sggs: [] };
        map.set(key, g);
      }
      g.total += r.trade_count;
      g.sggs.push(r);
    }
    return Array.from(map.values()).sort((a, b) => {
      const ai = SIDO_PRIORITY.indexOf(a.sido_cd);
      const bi = SIDO_PRIORITY.indexOf(b.sido_cd);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.sido_cd.localeCompare(b.sido_cd);
    });
  }, [summary]);

  const grandTotal = useMemo(() => summary.reduce((s, r) => s + r.trade_count, 0), [summary]);
  const currentSido = selectedSido ? sidoGroups.find(g => g.sido_cd === selectedSido) ?? null : null;
  const selectedSggInfo = selectedSgg ? summary.find(s => s.sgg_cd === selectedSgg) ?? null : null;

  // 지금 보고 있는 범위의 구·군 요약 행
  const scopeRows = useMemo<SummaryRow[]>(() => {
    if (selectedSgg) return selectedSggInfo ? [selectedSggInfo] : [];
    if (selectedSido) return currentSido?.sggs ?? [];
    return summary;
  }, [selectedSgg, selectedSggInfo, selectedSido, currentSido, summary]);

  const sggCards = selectedSido ? currentSido?.sggs ?? [] : summary;
  const sggCardsShown = selectedSido || showAllSgg ? sggCards : sggCards.slice(0, SGG_PREVIEW);
  const sggMax = Math.max(1, ...sggCards.map(s => s.trade_count));

  const scopeLabel = selectedSgg
    ? [selectedSggInfo?.sido_nm, selectedSggInfo?.sgg_nm ?? selectedSgg].filter(Boolean).join(' ')
    : selectedSido
      ? `${currentSido?.sido_nm ?? '선택한 시·도'} 전체`
      : '전국';

  // 지역만 거른 거래 (KPI 기준)
  const regionTrades = useMemo(() => {
    if (selectedSgg) return trades.filter(t => t.sgg_cd === selectedSgg);
    if (selectedSido) {
      const inSido = new Set(scopeRows.map(s => s.sgg_cd));
      return trades.filter(t => inSido.has(t.sgg_cd));
    }
    return trades;
  }, [trades, selectedSgg, selectedSido, scopeRows]);

  const kpi = useMemo(() => {
    const count = scopeRows.reduce((s, r) => s + r.trade_count, 0);
    if (!count) return null;
    // 목록이 상한에 걸리지 않았으면 거래 원본으로 정확히, 걸렸으면 구·군 요약의 가중 평균으로
    const avg = regionTrades.length === count
      ? regionTrades.reduce((s, t) => s + t.deal_amount, 0) / count
      : eokToManwon(scopeRows.reduce((s, r) => s + r.avg_eok * r.trade_count, 0) / count);
    let top: TradeRow | null = null;
    for (const t of regionTrades) if (!top || t.deal_amount > top.deal_amount) top = t;
    const busiest = scopeRows.reduce((m, r) => (r.trade_count > m.trade_count ? r : m), scopeRows[0]);
    return {
      count, avg, top, busiest,
      min: eokToManwon(Math.min(...scopeRows.map(r => r.min_eok))),
      max: eokToManwon(Math.max(...scopeRows.map(r => r.max_eok))),
    };
  }, [scopeRows, regionTrades]);

  // 글자·가격대 필터 + 정렬
  const qn = norm(q);
  const filteredTrades = useMemo(() => {
    const test = PRICE_BANDS.find(b => b.value === band)?.test ?? (() => true);
    const arr = regionTrades.filter(t =>
      test(t.deal_amount) &&
      (!qn || norm(t.apt_nm).includes(qn) || norm(t.umd_nm).includes(qn) || norm(t.sgg_nm).includes(qn) || norm(t.apt_dong).includes(qn)));
    const sign = sortDir === 'desc' ? -1 : 1;
    return arr.sort((a, b) => {
      let cmp: number;
      if (sortKey === 'apt_nm') cmp = (a.apt_nm ?? '').localeCompare(b.apt_nm ?? '', 'ko');
      else cmp = (a[sortKey] ?? 0) - (b[sortKey] ?? 0);
      return cmp * sign;
    });
  }, [regionTrades, band, qn, sortKey, sortDir]);

  const bandCounts = useMemo(() => {
    const base = qn
      ? regionTrades.filter(t => norm(t.apt_nm).includes(qn) || norm(t.umd_nm).includes(qn) || norm(t.sgg_nm).includes(qn) || norm(t.apt_dong).includes(qn))
      : regionTrades;
    const out = {} as Record<PriceBand, number>;
    for (const b of PRICE_BANDS) out[b.value] = base.reduce((n, t) => n + (b.test(t.deal_amount) ? 1 : 0), 0);
    return out;
  }, [regionTrades, qn]);

  // 필터가 바뀌면 다시 처음 200건부터 (효과 없이 키로 판정)
  const limitKey = `${date}|${selectedSido}|${selectedSgg}|${qn}|${band}`;
  const limit = limitState.key === limitKey ? limitState.limit : PAGE_SIZE;
  const showing = filteredTrades.slice(0, limit);
  const remaining = filteredTrades.length - showing.length;

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(k); setSortDir(k === 'apt_nm' ? 'asc' : 'desc'); }
  }

  function toggleSortTo(k: SortKey) {
    setSortKey(k);
    setSortDir(k === 'apt_nm' ? 'asc' : 'desc');
  }

  function clearRegion() { setSelectedSido(null); setSelectedSgg(null); }
  function resetListFilters() { setQ(''); setBand('all'); }

  function pickSgg(s: SummaryRow) {
    if (selectedSgg === s.sgg_cd) { setSelectedSgg(null); return; }
    setSelectedSgg(s.sgg_cd);
    setSelectedSido(s.sido_cd ?? 'unknown');
  }

  function toggleFav(t: TradeRow) {
    fav.toggle({ apt_nm: t.apt_nm, sgg_cd: t.sgg_cd, umd_nm: t.umd_nm, region: t.sgg_nm ?? undefined });
  }

  const recent = !!date && !!latestDate && dayDiff(latestDate, date) < 30;
  const capped = (data?.trades.length ?? 0) >= API_ROW_CAP && grandTotal > (data?.trades.length ?? 0);
  const hasListFilter = !!qn || band !== 'all';

  return (
    <Page>
      {HEADER}

      {/* 날짜 고르기 */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => changeDate(shiftDate(date, -1))} disabled={!date} aria-label="전날로 이동">
            <span aria-hidden>◀</span> 전날
          </Button>
          <input
            type="date"
            value={date}
            max={latestDate ?? undefined}
            onChange={e => { if (e.target.value) changeDate(e.target.value); }}
            aria-label="거래일 선택"
            className="field num !w-auto flex-1 min-w-[9.5rem] sm:flex-none sm:!w-44 !rounded-xl font-semibold"
          />
          <Button onClick={() => changeDate(shiftDate(date, 1))} disabled={!canGoNext} aria-label="다음날로 이동">
            다음날 <span aria-hidden>▶</span>
          </Button>
          <Button variant="ghost" onClick={() => latestDate && changeDate(latestDate)} disabled={!latestDate || date === latestDate}>
            최신
          </Button>
          <div className="sm:ml-auto w-full sm:w-auto flex items-baseline gap-2">
            <span className="num text-lg font-bold text-ink">{date ? formatKDate(date, true) : '날짜를 확인하는 중입니다'}</span>
            {date && latestDate && date === latestDate && <Badge tone="brand">최신 거래일</Badge>}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-ink-3 mr-1">최근 7일</span>
          {quickDates.length === 0
            ? Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-7 w-[4.5rem] !rounded-full" />)
            : quickDates.map(d => (
              <Chip key={d} active={d === date} onClick={() => changeDate(d)} className="num" aria-label={formatKDate(d, true)}>
                {formatShortDate(d)} <span className={d === date ? 'opacity-80' : 'text-ink-3'}>{dow(d)}</span>
              </Chip>
            ))}
          <span className="hidden md:inline ml-auto text-xs text-ink-3">키보드 ← → 로도 날짜를 옮길 수 있습니다</span>
        </div>
      </Card>

      {loadError ? (
        <div className="space-y-3">
          <ErrorBox>{loadError} 잠시 뒤 다시 시도해 주세요.</ErrorBox>
          <Button onClick={() => setRetry(n => n + 1)}>다시 불러오기</Button>
        </div>
      ) : loading ? (
        <LoadingBody />
      ) : grandTotal === 0 ? (
        <Card>
          <EmptyState
            icon="📭"
            title={`${formatKDate(date, true)}에 신고된 거래가 아직 없습니다`}
            desc={
              <>
                실거래 신고는 계약 후 30일 안에 하면 되기 때문에 최근 날짜는 나중에 채워집니다.
                {latestDate && date !== latestDate && <> 가장 최근 거래일은 <b className="num text-ink-2">{formatKDate(latestDate)}</b>입니다.</>}
              </>
            }
          />
          {latestDate && date !== latestDate && (
            <div className="flex justify-center -mt-6 pb-6">
              <Button variant="primary" onClick={() => changeDate(latestDate)}>최신 거래일 보기</Button>
            </div>
          )}
        </Card>
      ) : (
        <div className="space-y-6 rise" key={date}>
          {/* KPI */}
          <div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <Stat label={`총 거래건수 · ${scopeLabel}`} value={(kpi?.count ?? 0).toLocaleString()} unit="건"
                hint={selectedSido || selectedSgg ? `전국 ${grandTotal.toLocaleString()}건 가운데` : '해제된 거래는 빼고 셉니다'} />
              <Stat label="평균 거래가" value={kpi ? formatEok(kpi.avg, 2) : '-'}
                hint={kpi ? `최저 ${formatEok(kpi.min)} · 최고 ${formatEok(kpi.max)}` : undefined} />
              <Stat label="최고가 거래" value={kpi?.top ? formatEok(kpi.top.deal_amount, 1) : kpi ? formatEok(kpi.max) : '-'}
                hint={kpi?.top ? `${kpi.top.apt_nm} · ${kpi.top.sgg_nm ?? ''} ${toPyeong(kpi.top.exclu_use_ar)}평` : undefined} />
              <Stat label="거래 발생 지역" value={scopeRows.length.toLocaleString()} unit="개 구·군"
                hint={selectedSgg
                  ? '구·군 한 곳만 보고 있습니다'
                  : kpi?.busiest ? `가장 많은 곳 ${kpi.busiest.sgg_nm ?? kpi.busiest.sgg_cd} ${kpi.busiest.trade_count.toLocaleString()}건` : undefined} />
            </div>
            <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
              {recent && <Badge tone="warn">신고 진행 중</Badge>}
              <span>
                실거래 신고는 계약일부터 30일 안에 하면 됩니다.
                {recent ? ' 이 날짜의 거래는 앞으로도 조금씩 더 채워질 수 있습니다.' : ' 이 날짜는 신고 기간이 지나 건수가 거의 확정됐습니다.'}
              </span>
            </p>
          </div>

          {/* 지역 */}
          <Card>
            <CardTitle
              sub="시·도를 고르면 그 안의 구·군이 거래가 많은 순서로 나옵니다. 구·군을 누르면 아래 목록이 그 지역으로 좁혀집니다."
              right={(selectedSido || selectedSgg) && <Button size="sm" variant="ghost" onClick={clearRegion}>전체 보기</Button>}
            >
              지역별 거래
            </CardTitle>

            <div className="flex flex-wrap gap-1.5">
              <Chip active={selectedSido === null} onClick={clearRegion}>
                전체 <span className="num ml-1 text-xs opacity-70">{grandTotal.toLocaleString()}</span>
              </Chip>
              {sidoGroups.map(g => (
                <Chip key={g.sido_cd} active={selectedSido === g.sido_cd}
                  onClick={() => { setSelectedSido(selectedSido === g.sido_cd ? null : g.sido_cd); setSelectedSgg(null); }}>
                  {g.sido_nm} <span className="num ml-1 text-xs opacity-70">{g.total.toLocaleString()}</span>
                </Chip>
              ))}
            </div>

            <div className="mt-5 flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">
                구·군별 요약
                <span className="ml-2 text-xs font-normal text-ink-3">
                  {selectedSido ? `${currentSido?.sido_nm ?? ''} · ${sggCards.length}곳` : `전국 ${sggCards.length}곳 · 거래 많은 순`}
                </span>
              </h3>
            </div>

            {sggCards.length === 0 ? (
              <EmptyState title="이 날짜에는 선택한 시·도의 거래가 없습니다" desc="다른 시·도를 고르거나 전체 보기로 돌아가 주세요." />
            ) : (
              <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                {sggCardsShown.map((s, i) => {
                  const on = selectedSgg === s.sgg_cd;
                  return (
                    <li key={s.sgg_cd} className="min-w-0">
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => pickSgg(s)}
                        className={cx(
                          'w-full min-w-0 text-left rounded-xl border px-3.5 py-3 transition-colors cursor-pointer',
                          on ? 'border-brand bg-brand-soft' : 'border-line bg-surface-2 hover:border-brand',
                        )}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate text-sm font-semibold text-ink">
                            <span className="num mr-1.5 text-xs font-medium text-ink-3">{i + 1}</span>
                            {s.sgg_nm ?? s.sgg_cd}
                          </span>
                          <span className="num shrink-0 text-sm font-bold text-ink">
                            {s.trade_count.toLocaleString()}<span className="ml-0.5 text-xs font-medium text-ink-3">건</span>
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                          <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(3, (s.trade_count / sggMax) * 100)}%` }} />
                        </div>
                        <div className="mt-2 flex items-baseline justify-between gap-2 text-xs text-ink-3">
                          <span className="min-w-0 truncate">{selectedSido ? `최저 ${formatEok(eokToManwon(s.min_eok))} ~ 최고 ${formatEok(eokToManwon(s.max_eok))}` : s.sido_nm ?? '미분류'}</span>
                          <span className="num shrink-0">평균 <b className="font-semibold text-ink-2">{formatEok(eokToManwon(s.avg_eok))}</b></span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {!selectedSido && sggCards.length > SGG_PREVIEW && (
              <div className="mt-3 text-center">
                <Button size="sm" variant="ghost" onClick={() => setShowAllSgg(v => !v)}>
                  {showAllSgg ? '상위 지역만 보기' : `나머지 ${(sggCards.length - SGG_PREVIEW).toLocaleString()}곳 더 보기`}
                </Button>
              </div>
            )}
          </Card>

          {/* 거래 목록 */}
          <Card>
            <CardTitle
              sub={
                <>
                  {scopeLabel} · <span className="num">{filteredTrades.length.toLocaleString()}</span>건
                  {hasListFilter && <> (지역 전체 <span className="num">{regionTrades.length.toLocaleString()}</span>건 가운데)</>}
                  {' '}· 행을 누르면 그 단지의 거래 이력이 열립니다
                </>
              }
              right={(selectedSido || selectedSgg) && (
                <Chip active onClick={clearRegion} aria-label={`${scopeLabel} 지역 필터 해제`}>
                  {scopeLabel} <span aria-hidden className="ml-1">✕</span>
                </Chip>
              )}
            >
              거래 목록
            </CardTitle>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative lg:w-72">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" width="16" height="16" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
                </svg>
                <input
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="단지명 또는 동 이름으로 거르기"
                  aria-label="단지명 또는 동 이름으로 거르기"
                  className="field !pl-9 !rounded-xl"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PRICE_BANDS.map(b => (
                  <Chip key={b.value} active={band === b.value} onClick={() => setBand(b.value)}>
                    {b.label} <span className="num ml-1 text-xs opacity-70">{(bandCounts[b.value] ?? 0).toLocaleString()}</span>
                  </Chip>
                ))}
              </div>
              {isMobile && (
                <div className="flex items-center gap-2">
                  <select value={sortKey} onChange={e => toggleSortTo(e.target.value as SortKey)} aria-label="정렬 기준" className="field !rounded-xl">
                    {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label} 순</option>)}
                  </select>
                  <Button onClick={() => setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))} className="shrink-0">
                    {sortDir === 'desc' ? '높은 순' : '낮은 순'}
                  </Button>
                </div>
              )}
            </div>

            {capped && (
              <p className="mt-3 text-xs text-ink-3">
                거래가 많은 날이라 목록에는 금액이 큰 순서로 <span className="num">{API_ROW_CAP.toLocaleString()}</span>건까지만 담깁니다. 건수와 평균은 전체 기준입니다.
              </p>
            )}

            <div className="mt-4">
              {filteredTrades.length === 0 ? (
                <div>
                  <EmptyState title="조건에 맞는 거래가 없습니다" desc="검색어나 가격대, 지역 선택을 풀어 보세요." />
                  <div className="flex justify-center gap-2 -mt-6 pb-4">
                    {hasListFilter && <Button size="sm" onClick={resetListFilters}>검색어·가격대 풀기</Button>}
                    {(selectedSido || selectedSgg) && <Button size="sm" onClick={clearRegion}>지역 선택 풀기</Button>}
                  </div>
                </div>
              ) : isMobile ? (
                <ul className="space-y-2">
                  {showing.map((t, i) => (
                    <li key={`${t.sgg_cd}-${t.apt_nm}-${t.floor}-${t.exclu_use_ar}-${t.deal_amount}-${i}`}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setDetail(t)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetail(t); } }}
                        className="rounded-xl border border-line bg-surface-2 px-3.5 py-3 cursor-pointer hover:border-brand transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-ink">{t.apt_nm}</div>
                            <div className="mt-0.5 truncate text-xs text-ink-3">
                              {[t.sgg_nm ?? t.sgg_cd, t.umd_nm, t.apt_dong].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          <div className="-mr-1.5 -mt-1.5">
                            <StarButton active={fav.has(t.apt_nm, t.sgg_cd)} onToggle={() => toggleFav(t)} label={t.apt_nm} />
                          </div>
                        </div>
                        <div className="mt-2 flex items-end justify-between gap-2">
                          <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
                            <span className="num">{Number(t.exclu_use_ar.toFixed(1))}㎡ ({toPyeong(t.exclu_use_ar)}평)</span>
                            <span className="num">{t.floor ?? '-'}층</span>
                            <span className="num">{t.build_year ? `${t.build_year}년` : '-'}</span>
                            <DealType gbn={t.dealing_gbn} />
                          </div>
                          <div className="num shrink-0 text-base font-bold text-ink">{formatPrice(t.deal_amount)}</div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <TableWrap maxH="70vh">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="w-10" aria-label="관심단지" />
                        <SortTh label="단지" k="apt_nm" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                        <th>지역</th>
                        <SortTh label="전용면적(평)" k="exclu_use_ar" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                        <SortTh label="층" k="floor" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                        <SortTh label="건축년도" k="build_year" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                        <th>거래유형</th>
                        <SortTh label="거래가" k="deal_amount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} right />
                      </tr>
                    </thead>
                    <tbody>
                      {showing.map((t, i) => (
                        <tr
                          key={`${t.sgg_cd}-${t.apt_nm}-${t.floor}-${t.exclu_use_ar}-${t.deal_amount}-${i}`}
                          className="cursor-pointer"
                          tabIndex={0}
                          onClick={() => setDetail(t)}
                          onKeyDown={e => { if (e.key === 'Enter') setDetail(t); }}
                        >
                          <td className="!pr-0 !py-1">
                            <StarButton active={fav.has(t.apt_nm, t.sgg_cd)} onToggle={() => toggleFav(t)} label={t.apt_nm} />
                          </td>
                          <td>
                            <span className="font-semibold text-ink">{t.apt_nm}</span>
                            {t.apt_dong && <span className="ml-2 text-xs text-ink-3">{t.apt_dong}</span>}
                          </td>
                          <td className="text-ink-2">{[t.sgg_nm ?? t.sgg_cd, t.umd_nm].filter(Boolean).join(' ')}</td>
                          <td className="num !text-right text-ink-2">
                            {Number(t.exclu_use_ar.toFixed(1))}㎡ <span className="text-ink-3">({toPyeong(t.exclu_use_ar)}평)</span>
                          </td>
                          <td className="num !text-right text-ink-2">{t.floor ?? '-'}</td>
                          <td className="num !text-right text-ink-2">{t.build_year ?? '-'}</td>
                          <td><DealType gbn={t.dealing_gbn} /></td>
                          <td className="num !text-right font-bold text-ink">{formatPrice(t.deal_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </div>

            {remaining > 0 && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <span className="num text-xs text-ink-3 w-full text-center sm:w-auto">
                  {showing.length.toLocaleString()} / {filteredTrades.length.toLocaleString()}건 표시 중
                </span>
                <Button onClick={() => setLimitState({ key: limitKey, limit: limit + PAGE_SIZE })}>
                  {Math.min(PAGE_SIZE, remaining).toLocaleString()}건 더 보기
                </Button>
                {remaining > PAGE_SIZE && (
                  <Button variant="ghost" onClick={() => setLimitState({ key: limitKey, limit: filteredTrades.length })}>
                    남은 {remaining.toLocaleString()}건 모두 보기
                  </Button>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {detail && (
        <TradeDetailModal
          aptNm={detail.apt_nm}
          sggCd={detail.sgg_cd}
          sggName={detail.sgg_nm ?? ''}
          umdNm={detail.umd_nm ?? ''}
          onClose={() => setDetail(null)}
        />
      )}
    </Page>
  );
}
