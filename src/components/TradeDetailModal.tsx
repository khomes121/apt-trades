'use client';

/**
 * 단지 상세 — 한 단지의 실거래 이력을 평형별로 걸러 보고, 추이 차트·동별 단가·거래 목록을 본다.
 * 색은 의미 토큰만 쓴다(docs/DESIGN_SYSTEM.md). 평형별 계열 색만 고정 8색을 inline style 로 넣는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, Button, Chip, EmptyState, ErrorBox, Segmented, Skeleton, TableWrap, cx } from '@/components/ui';
import { formatArea, formatEok, formatKDate, formatPrice, formatRate, toPyeong, toYmd, trendColor } from '@/lib/format';
import { useFavorites } from '@/lib/favorites';

interface Trade {
  deal_date: string;
  deal_amount: number;
  floor: number;
  area_group: number;
  exclu_use_ar: number;
  apt_dong: string | null;
  pyeong: number;
  dealing_gbn: string | null;
  cdeal_type: string | null;
}

interface Props {
  aptNm: string;
  sggCd: string;
  sggName: string;
  umdNm: string;
  onClose: () => void;
}

/** 평형별 계열 색 — DESIGN_SYSTEM.md 의 순서. 밝은·어두운 화면 둘 다에서 읽힌다. */
const SERIES_COLORS = ['#2f5bea', '#12996b', '#8b5cf6', '#e08a00', '#e0393e', '#0ea5b7', '#d9480f', '#5c7cfa'];
const FALLBACK_COLOR = 'var(--ink-3)';

type DealingFilter = '전체' | '중개' | '직거래';
type FloorFilter = '전체' | '1층제외';
type DongTab = 'all' | number;
type PeriodKey = 'all' | '12' | '24' | '36' | '60';

const PERIOD_OPTIONS: Array<{ value: PeriodKey; label: string }> = [
  { value: 'all', label: '전체' },
  { value: '60', label: '5년' },
  { value: '36', label: '3년' },
  { value: '24', label: '2년' },
  { value: '12', label: '1년' },
];
const DEALING_OPTIONS: Array<{ value: DealingFilter; label: string }> = [
  { value: '전체', label: '전체' }, { value: '중개', label: '중개' }, { value: '직거래', label: '직거래' },
];
const FLOOR_OPTIONS: Array<{ value: FloorFilter; label: string }> = [
  { value: '전체', label: '전체 층' }, { value: '1층제외', label: '1층 제외' },
];
const PAGE_SIZE = 50;

interface Delta { diff: number; rate: number; prev: Trade }
interface Pt { x: number; y: number; t: Trade; color: string; direct: boolean; delta: Delta | null }

function floorAreaKey(t: Trade): number { return Math.floor(t.exclu_use_ar ?? t.area_group); }
function tradeArea(t: Trade): number { return t.exclu_use_ar ?? t.area_group; }
function isDirect(t: Trade): boolean { return t.dealing_gbn === '직거래'; }
function dotDate(ymd: string): string { return ymd.replaceAll('-', '.'); }

function normalizeDong(dong: string | null): string | null {
  if (!dong || !dong.trim()) return null;
  const d = dong.trim();
  // 이미 "동"으로 끝나면 그대로, 아니면 "동" 붙임 (예: "5" → "5동", "가동" → "가동")
  return d.endsWith('동') ? d : `${d}동`;
}

function signedPrice(diff: number): string {
  if (diff === 0) return '변동 없음';
  return `${diff > 0 ? '+' : '-'}${formatPrice(Math.abs(diff))}`;
}

/** 차트 Y축 "nice number" — 1억, 1.5억, 2억 같은 깔끔한 구간 */
function niceAxisValues(min: number, max: number): number[] {
  if (min === max) {
    const pad = Math.max(1000, Math.round(min * 0.1 / 1000) * 1000);
    return [Math.max(0, min - pad), min, min + pad];
  }
  const roughStep = (max - min) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const factor = [1, 2, 2.5, 5, 10].find(f => f * mag >= roughStep) ?? 10;
  const step = factor * mag;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const vals: number[] = [];
  for (let v = niceMin; v <= niceMax + step * 0.01; v += step) vals.push(Math.round(v));
  return vals;
}

const DAY_MS = 864e5;

/** X축 눈금 — 기간 길이에 맞춰 월·분기·연 단위로 끊는다 (deal_date 는 UTC 자정으로 읽힌다) */
function dateTicks(min: number, max: number): { ticks: number[]; yearly: boolean } {
  const spanMonths = (max - min) / (30.44 * DAY_MS);
  const step = spanMonths <= 8 ? 1 : spanMonths <= 16 ? 2 : spanMonths <= 30 ? 3
    : spanMonths <= 60 ? 6 : spanMonths <= 120 ? 12 : spanMonths <= 240 ? 24 : 60;
  const s = new Date(min);
  let m = s.getUTCFullYear() * 12 + s.getUTCMonth();
  m = Math.ceil(m / step) * step;
  const ticks: number[] = [];
  for (let guard = 0; guard < 80; guard++, m += step) {
    const ts = Date.UTC(Math.floor(m / 12), m % 12, 1);
    if (ts > max) break;
    if (ts >= min) ticks.push(ts);
  }
  return { ticks, yearly: step >= 12 };
}

// ── 작은 부품 ───────────────────────────────────────────────────────────────

function Tile({ label, value, hint, valueClass, className }: {
  label: string; value: React.ReactNode; hint?: React.ReactNode; valueClass?: string; className?: string;
}) {
  return (
    <div className={cx('min-w-0 rounded-xl border border-line bg-surface-2 px-3.5 py-3', className)}>
      <div className="text-[0.6875rem] font-medium text-ink-3">{label}</div>
      <div className={cx('num mt-1 text-lg sm:text-xl font-bold leading-tight truncate', valueClass ?? 'text-ink')}>{value}</div>
      <div className="num mt-1 min-h-4 text-[0.6875rem] leading-4 text-ink-3 truncate">{hint ?? ' '}</div>
    </div>
  );
}

function Section({ title, sub, right, children }: {
  title: string; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-ink-3">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-xs font-semibold text-ink-2">{label}</span>
      {children}
    </div>
  );
}

function ColorDot({ color, hollow }: { color: string; hollow?: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={hollow
        ? { boxShadow: `inset 0 0 0 2px ${color}` }
        : { background: color, boxShadow: '0 0 0 1.5px var(--surface)' }}
    />
  );
}

function DeltaText({ delta, compact }: { delta: Delta | null | undefined; compact?: boolean }) {
  if (!delta) return <span className="text-ink-3">-</span>;
  if (delta.diff === 0) return <span className="text-ink-3">변동 없음</span>;
  return (
    <span className={cx('num font-semibold', trendColor(delta.diff))}>
      {signedPrice(delta.diff)}
      <span className={cx('font-medium', compact ? 'ml-1' : 'ml-1.5 text-xs')}>{formatRate(delta.rate)}</span>
    </span>
  );
}

function renderDot(props: unknown, r: number) {
  const { cx: x, cy: y, payload } = props as { cx?: number; cy?: number; payload?: Pt };
  if (x == null || y == null || !payload) return <g />;
  return payload.direct
    ? <circle cx={x} cy={y} r={r} fill="var(--surface)" stroke={payload.color} strokeWidth={2} />
    : <circle cx={x} cy={y} r={r} fill={payload.color} fillOpacity={0.85} stroke="var(--surface)" strokeWidth={1} />;
}
const dotShape = (props: unknown) => renderDot(props, 4);
const dotActiveShape = (props: unknown) => renderDot(props, 6.5);
const hiddenShape = () => <g />;

function TradeTip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: Pt }> }) {
  const p = payload?.[0]?.payload;
  if (!active || !p?.t) return null;
  const t = p.t;
  const dong = normalizeDong(t.apt_dong);
  return (
    <div className="min-w-44 rounded-xl border border-line bg-surface px-3 py-2.5 text-xs shadow-pop">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-ink">{formatKDate(t.deal_date, true)}</span>
        {p.direct && <Badge tone="warn">직거래</Badge>}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-ink-2">
        <ColorDot color={p.color} />
        <span className="num">{formatArea(tradeArea(t))}</span>
        <span className="text-ink-3">·</span>
        <span className="num">{dong ? `${dong} ` : ''}{t.floor}층</span>
      </div>
      <div className="num mt-1.5 text-base font-bold text-ink">{formatPrice(t.deal_amount)}</div>
      {p.delta && (
        <div className="mt-1 flex items-center justify-between gap-3 border-t border-line pt-1.5 text-ink-3">
          <span>같은 평형 직전 대비</span>
          <DeltaText delta={p.delta} compact />
        </div>
      )}
    </div>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8L12 3.5z" />
    </svg>
  );
}

function LoadingView() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="거래 내역을 불러오는 중입니다">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        <Skeleton className="col-span-2 md:col-span-1 h-[5.25rem] !rounded-xl" />
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[5.25rem] !rounded-xl" />)}
      </div>
      <Skeleton className="h-9 !rounded-xl" />
      <Skeleton className="h-80 !rounded-2xl" />
      <Skeleton className="h-48 !rounded-2xl" />
      <Skeleton className="h-64 !rounded-2xl" />
    </div>
  );
}

// ── 본체 ────────────────────────────────────────────────────────────────────

export default function TradeDetailModal({ aptNm, sggCd, sggName, umdNm, onClose }: Props) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedAreas, setSelectedAreas] = useState<Set<number>>(new Set());
  const [dealingFilter, setDealingFilter] = useState<DealingFilter>('전체');
  const [floorFilter, setFloorFilter] = useState<FloorFilter>('전체');
  const [dongTab, setDongTab] = useState<DongTab>('all');
  const [period, setPeriod] = useState<PeriodKey>('12');
  const [showAvgLine, setShowAvgLine] = useState(true);
  const [tradeListLimit, setTradeListLimit] = useState(PAGE_SIZE); // 0 = 접힘
  const [openedAt] = useState(() => new Date());

  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { has, toggle } = useFavorites();
  const isFav = has(aptNm, sggCd);

  useEffect(() => {
    let alive = true;
    fetch('/api/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apt_nm: aptNm, sgg_cd: sggCd }),
    })
      .then(r => r.json())
      .then((d: { results?: Trade[]; error?: string }) => {
        if (!alive) return;
        if (!Array.isArray(d.results)) throw new Error(d.error ?? 'bad response');
        setTrades(d.results);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setError('거래 내역을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.');
        setLoading(false);
      });
    return () => { alive = false; };
  }, [aptNm, sggCd]);

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  // ESC 닫기 + Tab 이 모달 밖으로 새지 않게
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const els = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      const cur = document.activeElement;
      if (e.shiftKey && (cur === first || !panelRef.current.contains(cur))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (cur === last || !panelRef.current.contains(cur))) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // 열려 있는 동안 뒤 화면 스크롤 잠금 + 닫기 버튼에 초점, 닫히면 원래 자리로
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, []);

  /* ── 파생 데이터 ── */

  // 계약일 오름차순 (API 가 이미 정렬해 주지만 여기서 한 번 더 보장한다)
  const sortedTrades = useMemo(
    () => [...trades].sort((a, b) => a.deal_date.localeCompare(b.deal_date)),
    [trades],
  );

  // 평형 색은 전체 이력 기준으로 고정 — 기간을 바꿔도 색이 바뀌지 않는다
  const areaColorMap = useMemo(() => {
    const keys = [...new Set(sortedTrades.map(floorAreaKey))].sort((a, b) => a - b);
    const m: Record<number, string> = {};
    keys.forEach((a, i) => { m[a] = SERIES_COLORS[i % SERIES_COLORS.length]; });
    return m;
  }, [sortedTrades]);

  // 거래유형 필터 (전체 기간)
  const dealingAllTrades = useMemo(() => {
    if (dealingFilter === '중개') return sortedTrades.filter(x => !isDirect(x));
    if (dealingFilter === '직거래') return sortedTrades.filter(isDirect);
    return sortedTrades;
  }, [sortedTrades, dealingFilter]);

  // 같은 평형 직전 거래 대비 — 기간 밖의 직전 거래도 비교 대상이 되도록 전체 기간에서 계산
  const deltaMap = useMemo(() => {
    const m = new Map<Trade, Delta>();
    const last = new Map<number, Trade>();
    for (const t of dealingAllTrades) {
      const k = floorAreaKey(t);
      const prev = last.get(k);
      if (prev && prev.deal_amount > 0) {
        const diff = t.deal_amount - prev.deal_amount;
        m.set(t, { diff, rate: (diff / prev.deal_amount) * 100, prev });
      }
      last.set(k, t);
    }
    return m;
  }, [dealingAllTrades]);

  const cutoffYmd = useMemo(() => {
    if (period === 'all') return null;
    const c = new Date(openedAt);
    c.setMonth(c.getMonth() - Number(period));
    return toYmd(c);
  }, [period, openedAt]);

  // 기간 필터
  const periodFilteredTrades = useMemo(
    () => (cutoffYmd ? sortedTrades.filter(t => t.deal_date >= cutoffYmd) : sortedTrades),
    [sortedTrades, cutoffYmd],
  );

  // 기간 + 거래유형 필터 (평형 필터 제외) — 평형별 통계 기준
  const dealingFilteredTrades = useMemo(
    () => (cutoffYmd ? dealingAllTrades.filter(t => t.deal_date >= cutoffYmd) : dealingAllTrades),
    [dealingAllTrades, cutoffYmd],
  );

  const areaGroups = useMemo(
    () => [...new Set(dealingFilteredTrades.map(floorAreaKey))].sort((a, b) => a - b),
    [dealingFilteredTrades],
  );

  // 지금 조건에 실제로 있는 평형만 필터로 인정한다 (기간을 바꿔 사라진 평형 때문에 0건이 되지 않게)
  const activeAreas = useMemo(
    () => new Set(areaGroups.filter(a => selectedAreas.has(a))),
    [areaGroups, selectedAreas],
  );
  const hasFilter = activeAreas.size > 0;

  // 평형별 통계 (기간 + 거래유형 필터 기준)
  const areaStats = useMemo(() =>
    areaGroups.map(area => {
      const t = dealingFilteredTrades.filter(x => floorAreaKey(x) === area);
      const amounts = t.map(x => x.deal_amount);
      const avg = Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length);
      const latest = t[t.length - 1]?.deal_date ?? '';
      // 변동폭용: 1층 제외 옵션 적용
      const tForRange = floorFilter === '1층제외' ? t.filter(x => x.floor !== 1) : t;
      const rangeAmounts = tForRange.length > 0 ? tForRange.map(x => x.deal_amount) : amounts;
      return {
        area, count: t.length, avg, latest,
        rangeMin: Math.min(...rangeAmounts), rangeMax: Math.max(...rangeAmounts),
      };
    }),
    [dealingFilteredTrades, areaGroups, floorFilter],
  );

  // 동별 분석 (항상 전체 기간 · 중개거래만 · 동 정보 있는 거래만)
  const dongAnalysis = useMemo(() => {
    type WithDong = Trade & { dongLabel: string };
    const withDong = trades
      .filter(t => !isDirect(t))
      .map(t => ({ ...t, dongLabel: normalizeDong(t.apt_dong) }))
      .filter((t): t is WithDong => t.dongLabel !== null);
    if (withDong.length === 0) return null;

    const dongs = [...new Set(withDong.map(t => t.dongLabel))].sort((a, b) => {
      const na = parseInt(a); const nb = parseInt(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b, 'ko');
    });
    const types = [...new Set(withDong.map(floorAreaKey))].sort((a, b) => a - b);

    const calcDongRows = (subset: WithDong[]) =>
      dongs.flatMap(dong => {
        const t = subset.filter(x => x.dongLabel === dong);
        if (t.length === 0) return [];
        const unit = t.map(x => x.deal_amount / x.area_group);
        const avg = unit.reduce((a, b) => a + b, 0) / unit.length;
        return [{ dong, count: t.length, avgUnitPrice: Math.round(avg * 10) / 10 }];
      }).sort((a, b) => b.avgUnitPrice - a.avgUnitPrice);

    const typeRows = types
      .map(type => ({ type, rows: calcDongRows(withDong.filter(t => floorAreaKey(t) === type)) }))
      .filter(t => t.rows.length > 0);

    return { overallRows: calcDongRows(withDong), typeRows, totalWithDong: withDong.length };
  }, [trades]);

  // 표시용 거래 (기간 + 거래유형 + 평형) — 요약·차트·목록 기준. 오름차순.
  const displayTrades = useMemo(() => {
    if (activeAreas.size === 0) return dealingFilteredTrades;
    return dealingFilteredTrades.filter(x => activeAreas.has(floorAreaKey(x)));
  }, [dealingFilteredTrades, activeAreas]);

  const summary = useMemo(() => {
    if (!displayTrades.length) return null;
    let hi = displayTrades[0];
    let lo = displayTrades[0];
    for (const t of displayTrades) {
      if (t.deal_amount > hi.deal_amount) hi = t;
      if (t.deal_amount < lo.deal_amount) lo = t;
    }
    const latest = displayTrades[displayTrades.length - 1];
    return { hi, lo, latest, delta: deltaMap.get(latest) ?? null };
  }, [displayTrades, deltaMap]);

  // 차트 데이터
  const chart = useMemo(() => {
    if (!displayTrades.length) return null;
    const byArea = new Map<number, Pt[]>();
    for (const t of displayTrades) {
      const k = floorAreaKey(t);
      const pt: Pt = {
        x: new Date(t.deal_date).getTime(), y: t.deal_amount, t,
        color: areaColorMap[k] ?? FALLBACK_COLOR, direct: isDirect(t), delta: deltaMap.get(t) ?? null,
      };
      const arr = byArea.get(k);
      if (arr) arr.push(pt); else byArea.set(k, [pt]);
    }
    const series = [...byArea.entries()].sort((a, b) => a[0] - b[0]).map(([area, points]) => {
      // 월 평균선 — 직거래는 시세와 동떨어진 경우가 많아 평균에서 뺀다 (직거래만 볼 때는 포함)
      const months = new Map<string, number[]>();
      for (const p of points) {
        if (p.direct && dealingFilter !== '직거래') continue;
        const ym = p.t.deal_date.slice(0, 7);
        const arr = months.get(ym);
        if (arr) arr.push(p.y); else months.set(ym, [p.y]);
      }
      const avgLine = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([ym, v]) => ({
        x: new Date(`${ym}-15`).getTime(),
        y: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
      }));
      return { area, color: areaColorMap[area] ?? FALLBACK_COLOR, points, avgLine };
    });

    const xs = displayTrades.map(t => new Date(t.deal_date).getTime());
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const padX = Math.max((maxX - minX) * 0.03, 10 * DAY_MS);
    const prices = displayTrades.map(t => t.deal_amount);
    const axisValues = niceAxisValues(Math.min(...prices), Math.max(...prices));
    const { ticks, yearly } = dateTicks(minX - padX, maxX + padX);
    return {
      series, axisValues, xTicks: ticks, yearly,
      xDomain: [minX - padX, maxX + padX] as [number, number],
      yDomain: [axisValues[0], axisValues[axisValues.length - 1]] as [number, number],
      yDigits: axisValues.every(v => v % 1000 === 0) ? 1 : 2,
    };
  }, [displayTrades, areaColorMap, deltaMap, dealingFilter]);

  const directCount = useMemo(() => periodFilteredTrades.filter(isDirect).length, [periodFilteredTrades]);

  function toggleArea(area: number) {
    setSelectedAreas(prev => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area); else next.add(area);
      return next;
    });
  }

  const naverSearchUrl = `https://search.naver.com/search.naver?query=${encodeURIComponent(`${umdNm} ${aptNm}`)}`;
  const titleId = 'trade-detail-title';

  // 거래 목록 — 최신순, 50건씩
  const newestFirst = useMemo(() => [...displayTrades].reverse(), [displayTrades]);
  const showing = tradeListLimit > 0 ? newestFirst.slice(0, tradeListLimit) : [];
  const remaining = newestFirst.length - showing.length;

  const activeDongRows = !dongAnalysis ? []
    : dongTab === 'all' ? dongAnalysis.overallRows
    : (dongAnalysis.typeRows.find(t => t.type === dongTab)?.rows ?? []);
  const maxUnitPrice = Math.max(...activeDongRows.map(r => r.avgUnitPrice), 1);

  const filterLabel = hasFilter
    ? [...activeAreas].sort((a, b) => a - b).map(a => `${a}㎡`).join(' · ')
    : '전체 평형';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6 backdrop-blur-sm"
      style={{ background: 'rgb(8 12 20 / 0.55)' }}
      onClick={handleBackdrop}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="rise flex h-[100dvh] w-full flex-col overflow-hidden bg-surface shadow-pop sm:h-auto sm:max-h-[92vh] sm:max-w-5xl sm:rounded-2xl sm:border sm:border-line"
      >
        {/* 헤더 */}
        <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-lg font-bold tracking-tight text-ink sm:text-xl">{aptNm}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-2 sm:text-sm">
              <span className="truncate">{sggName} {umdNm}</span>
              <span className="text-line-strong" aria-hidden>|</span>
              <a
                href={naverSearchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-ok hover:underline"
              >
                네이버 검색 ↗
              </a>
            </div>
          </div>
          <button
            type="button"
            onClick={() => toggle({ apt_nm: aptNm, sgg_cd: sggCd, umd_nm: umdNm, region: sggName })}
            aria-pressed={isFav}
            aria-label={isFav ? '관심단지에서 빼기' : '관심단지에 담기'}
            title={isFav ? '관심단지에서 빼기' : '관심단지에 담기'}
            className={cx(
              'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-sm font-semibold transition-colors cursor-pointer',
              isFav ? 'border-warn/30 bg-warn-soft text-warn' : 'border-line-strong text-ink-2 hover:bg-surface-2',
            )}
          >
            <StarIcon filled={isFav} />
            <span className="hidden sm:inline">{isFav ? '관심단지' : '관심 담기'}</span>
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink cursor-pointer"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          {loading && <LoadingView />}
          {!loading && error && <ErrorBox>{error}</ErrorBox>}
          {!loading && !error && trades.length === 0 && (
            <EmptyState title="거래 내역이 없습니다" desc="이 단지는 아직 신고된 매매 실거래가 없습니다." />
          )}

          {!loading && !error && trades.length > 0 && (
            <div className="space-y-5">

              {/* ① 요약 */}
              <div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                  <Tile
                    className="col-span-2 md:col-span-1"
                    label="최근 거래가"
                    value={summary ? formatPrice(summary.latest.deal_amount) : '-'}
                    hint={summary && `${dotDate(summary.latest.deal_date)} · ${floorAreaKey(summary.latest)}㎡ · ${summary.latest.floor}층`}
                  />
                  <Tile
                    label="직전 거래 대비"
                    value={summary?.delta ? (summary.delta.diff === 0 ? '변동 없음' : formatRate(summary.delta.rate)) : '-'}
                    valueClass={summary?.delta ? trendColor(summary.delta.diff) : 'text-ink-3'}
                    hint={summary?.delta
                      ? `${signedPrice(summary.delta.diff)} · 같은 평형 ${dotDate(summary.delta.prev.deal_date)}`
                      : summary ? '같은 평형의 직전 거래가 없습니다' : undefined}
                  />
                  <Tile
                    label={hasFilter ? '조건에 맞는 거래' : '총 거래'}
                    value={<>{displayTrades.length.toLocaleString()}<span className="ml-0.5 text-sm font-semibold text-ink-2">건</span></>}
                    hint={period === 'all' ? '전체 기간' : `최근 ${PERIOD_OPTIONS.find(o => o.value === period)?.label}`}
                  />
                  <Tile
                    label="최고가"
                    value={summary ? formatPrice(summary.hi.deal_amount) : '-'}
                    hint={summary && `${dotDate(summary.hi.deal_date)} · ${floorAreaKey(summary.hi)}㎡ · ${summary.hi.floor}층`}
                  />
                  <Tile
                    label="최저가"
                    value={summary ? formatPrice(summary.lo.deal_amount) : '-'}
                    hint={summary && `${dotDate(summary.lo.deal_date)} · ${floorAreaKey(summary.lo)}㎡ · ${summary.lo.floor}층`}
                  />
                </div>
                <p className="mt-2 text-xs text-ink-3">
                  기준 <span className="font-medium text-ink-2">{filterLabel}</span>
                  {' · '}해제된 거래는 빠져 있습니다.
                </p>
              </div>

              {/* ② 필터 */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
                  <FilterGroup label="기간">
                    <Segmented size="sm" value={period} options={PERIOD_OPTIONS} onChange={setPeriod} />
                  </FilterGroup>
                  <FilterGroup label="거래유형">
                    <Segmented size="sm" value={dealingFilter} options={DEALING_OPTIONS} onChange={setDealingFilter} />
                  </FilterGroup>
                  <span className="num text-xs text-ink-3">
                    {period === 'all'
                      ? `전체 ${trades.length.toLocaleString()}건`
                      : `최근 ${period}개월 ${periodFilteredTrades.length.toLocaleString()}건`}
                    {directCount > 0 && dealingFilter === '전체' && ` · 직거래 ${directCount.toLocaleString()}건 포함`}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 shrink-0 text-xs font-semibold text-ink-2">평형</span>
                  <Chip active={!hasFilter} onClick={() => setSelectedAreas(new Set())}>전체</Chip>
                  {areaStats.map(s => (
                    <Chip
                      key={s.area}
                      active={activeAreas.has(s.area)}
                      aria-pressed={activeAreas.has(s.area)}
                      onClick={() => toggleArea(s.area)}
                      className="inline-flex items-center gap-1.5"
                    >
                      <ColorDot color={areaColorMap[s.area] ?? FALLBACK_COLOR} />
                      <span className="num">{s.area}㎡</span>
                      <span className="num text-xs opacity-70">{toPyeong(s.area)}평 · {s.count}</span>
                    </Chip>
                  ))}
                  {areaGroups.length > 1 && (
                    <span className="ml-1 text-xs text-ink-3">여러 개를 함께 고를 수 있습니다</span>
                  )}
                </div>
              </div>

              {/* ③ 차트 */}
              <Section
                title="거래가 추이"
                sub={
                  <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>점 색 = 평형</span>
                    <span className="inline-flex items-center gap-1"><ColorDot color="var(--ink-3)" hollow /> 빈 원 = 직거래</span>
                    {showAvgLine && <span>선 = 월 평균{dealingFilter !== '직거래' && ' (직거래 제외)'}</span>}
                  </span>
                }
                right={
                  <Chip size="sm" active={showAvgLine} aria-pressed={showAvgLine} onClick={() => setShowAvgLine(v => !v)}>
                    월 평균선
                  </Chip>
                }
              >
                <div className="h-64 sm:h-80 -ml-1">
                  {!chart ? (
                    <div className="flex h-full items-center justify-center text-sm text-ink-3">
                      이 조건에 맞는 거래가 없습니다. 기간을 넓혀 보세요.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke="var(--line)" vertical={false} />
                        <XAxis
                          type="number" dataKey="x" domain={chart.xDomain} ticks={chart.xTicks}
                          tickFormatter={(v: number) => {
                            const d = new Date(v);
                            return chart.yearly
                              ? `${d.getUTCFullYear()}`
                              : `${String(d.getUTCFullYear()).slice(2)}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
                          }}
                          tick={{ fontSize: 11, fill: 'var(--ink-3)' }} axisLine={{ stroke: 'var(--line)' }} tickLine={false}
                          minTickGap={16}
                        />
                        <YAxis
                          type="number" dataKey="y" domain={chart.yDomain} ticks={chart.axisValues}
                          tickFormatter={(v: number) => formatEok(v, chart.yDigits)}
                          tick={{ fontSize: 11, fill: 'var(--ink-3)' }} axisLine={false} tickLine={false} width={52}
                        />
                        <Tooltip
                          content={<TradeTip />}
                          cursor={{ stroke: 'var(--line-strong)', strokeDasharray: '3 3' }}
                          isAnimationActive={false}
                        />
                        {showAvgLine && chart.series.map(s => s.avgLine.length > 1 && (
                          <Scatter
                            key={`avg-${s.area}`} name={`${s.area}㎡ 월 평균`} data={s.avgLine}
                            line={{ stroke: s.color, strokeWidth: 2, strokeOpacity: 0.55 }} lineJointType="monotoneX"
                            shape={hiddenShape} tooltipType="none" legendType="none" isAnimationActive={false}
                          />
                        ))}
                        {chart.series.map(s => (
                          <Scatter
                            key={s.area} name={`${s.area}㎡`} data={s.points} fill={s.color}
                            shape={dotShape} activeShape={dotActiveShape} isAnimationActive={false}
                          />
                        ))}
                      </ScatterChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </Section>

              {/* ④ 평형별 통계 — 행을 눌러도 평형 필터가 걸린다 */}
              <Section
                title="평형별 통계"
                sub={floorFilter === '1층제외'
                  ? '최저·최고·변동폭은 1층 거래를 빼고 계산했습니다.'
                  : '행을 누르면 그 평형만 골라 봅니다.'}
                right={
                  <FilterGroup label="변동폭">
                    <Segmented size="sm" value={floorFilter} options={FLOOR_OPTIONS} onChange={setFloorFilter} />
                  </FilterGroup>
                }
              >
                {areaStats.length === 0 ? (
                  <p className="py-6 text-center text-sm text-ink-3">이 조건에 맞는 거래가 없습니다.</p>
                ) : (
                  <TableWrap>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>평형</th>
                          <th className="!text-right">건수</th>
                          <th className="!text-right">최저</th>
                          <th className="!text-right">평균</th>
                          <th className="!text-right">최고</th>
                          <th className="!text-right">변동폭</th>
                          <th className="!text-right">최근 거래</th>
                        </tr>
                      </thead>
                      <tbody>
                        {areaStats.map(s => {
                          const isSelected = activeAreas.has(s.area);
                          const isDimmed = hasFilter && !isSelected;
                          return (
                            <tr
                              key={s.area}
                              onClick={() => toggleArea(s.area)}
                              className={cx('cursor-pointer transition-opacity', isSelected && 'bg-brand-soft', isDimmed && 'opacity-45')}
                            >
                              <td>
                                <span className="flex items-center gap-2">
                                  <ColorDot color={areaColorMap[s.area] ?? FALLBACK_COLOR} />
                                  <span className="num font-semibold text-ink">{s.area}㎡</span>
                                  <span className="num text-xs text-ink-3">{toPyeong(s.area)}평</span>
                                </span>
                              </td>
                              <td className="num !text-right text-ink-2">{s.count.toLocaleString()}</td>
                              <td className="num !text-right text-down">{formatPrice(s.rangeMin)}</td>
                              <td className="num !text-right font-bold text-ink">{formatPrice(s.avg)}</td>
                              <td className="num !text-right text-up">{formatPrice(s.rangeMax)}</td>
                              <td className="num !text-right font-medium text-ink-2">{formatPrice(s.rangeMax - s.rangeMin)}</td>
                              <td className="num !text-right text-ink-3">{s.latest.slice(0, 7).replace('-', '.')}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </TableWrap>
                )}
              </Section>

              {/* ⑤ 동별 단가(로얄동) — 항상 전체 기간·중개거래 기준 */}
              {dongAnalysis && (
                <Section
                  title="동별 단가 비교"
                  sub={<span className="num">어느 동이 비싸게 거래됐는지 ㎡당 평균가로 봅니다 · 중개거래 {dongAnalysis.totalWithDong.toLocaleString()}건 · 전체 기간</span>}
                >
                  <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    <Chip size="sm" active={dongTab === 'all'} onClick={() => setDongTab('all')}>전체</Chip>
                    {dongAnalysis.typeRows.map(({ type }) => (
                      <Chip key={type} size="sm" active={dongTab === type} onClick={() => setDongTab(type)}>
                        <span className="num">{type}㎡</span>
                      </Chip>
                    ))}
                  </div>
                  {dongTab === 'all' && dongAnalysis.typeRows.length > 1 && (
                    <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
                      전체 보기는 동마다 평형 구성이 달라 순위가 왜곡될 수 있습니다. 평형을 골라서 보시면 더 정확합니다.
                    </p>
                  )}
                  {activeDongRows.length === 0 ? (
                    <p className="py-4 text-center text-sm text-ink-3">이 평형은 동 정보가 있는 거래가 없습니다.</p>
                  ) : (
                    <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                      {activeDongRows.map((r, i) => {
                        const lowSample = r.count < 5;
                        return (
                          <li key={r.dong} className="flex items-center gap-2 text-xs">
                            <span className={cx('num w-5 shrink-0 text-right font-bold', i < 3 ? 'text-brand' : 'text-ink-3')}>{i + 1}</span>
                            <span className="num w-14 shrink-0 truncate font-medium text-ink">{r.dong}</span>
                            <div className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
                              <div
                                className={cx('absolute inset-y-0 left-0 rounded-full transition-[width] duration-300',
                                  lowSample ? 'bg-line-strong' : i === 0 ? 'bg-brand' : 'bg-brand/55')}
                                style={{ width: `${(r.avgUnitPrice / maxUnitPrice) * 100}%` }}
                              />
                            </div>
                            <span className="num w-[4.5rem] shrink-0 text-right font-semibold text-ink">
                              {Math.round(r.avgUnitPrice).toLocaleString()}<span className="font-normal text-ink-3">만/㎡</span>
                            </span>
                            <span className="num w-9 shrink-0 text-right text-ink-3">{r.count}건</span>
                            <span className="w-[3.25rem] shrink-0">
                              {lowSample && <Badge tone="warn" className="!px-1.5 !text-[0.625rem]">표본 적음</Badge>}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Section>
              )}

              {/* ⑥ 거래 목록 — 최신순, 50건씩 */}
              <Section
                title="거래 목록"
                sub={
                  <span className="num">
                    {tradeListLimit === 0
                      ? `${newestFirst.length.toLocaleString()}건 · 접혀 있습니다`
                      : `최신순 · ${showing.length.toLocaleString()} / ${newestFirst.length.toLocaleString()}건 표시`}
                  </span>
                }
                right={
                  <Button
                    variant="ghost" size="sm" aria-expanded={tradeListLimit > 0}
                    onClick={() => setTradeListLimit(v => (v === 0 ? PAGE_SIZE : 0))}
                  >
                    {tradeListLimit === 0 ? '펼치기' : '접기'}
                  </Button>
                }
              >
                {tradeListLimit > 0 && (newestFirst.length === 0 ? (
                  <EmptyState title="이 조건에 맞는 거래가 없습니다" desc="기간을 넓히거나 평형·거래유형 조건을 풀어 보세요." />
                ) : (
                  <>
                    <TableWrap maxH="28rem">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>계약일</th>
                            <th>전용면적</th>
                            <th>동</th>
                            <th className="!text-right">층</th>
                            <th className="!text-right">거래가</th>
                            <th className="!text-right">직전 대비</th>
                            <th>거래유형</th>
                          </tr>
                        </thead>
                        <tbody>
                          {showing.map((t, i) => (
                            <tr key={`${t.deal_date}-${t.floor}-${t.deal_amount}-${i}`}>
                              <td className="num text-ink-2">{dotDate(t.deal_date)}</td>
                              <td>
                                <span className="flex items-center gap-2">
                                  <ColorDot color={areaColorMap[floorAreaKey(t)] ?? FALLBACK_COLOR} />
                                  <span className="num text-ink-2">{formatArea(tradeArea(t))}</span>
                                </span>
                              </td>
                              <td className="num text-ink-2">{normalizeDong(t.apt_dong) ?? <span className="text-ink-3">-</span>}</td>
                              <td className="num !text-right text-ink-2">{t.floor}층</td>
                              <td className="num !text-right font-bold text-ink">{formatPrice(t.deal_amount)}</td>
                              <td className="!text-right text-xs"><DeltaText delta={deltaMap.get(t)} compact /></td>
                              <td>
                                {isDirect(t)
                                  ? <Badge tone="warn">직거래</Badge>
                                  : t.dealing_gbn
                                    ? <Badge tone="neutral">중개</Badge>
                                    : <span className="text-ink-3">-</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableWrap>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-ink-3">직전 대비는 같은 평형의 바로 앞 거래와 비교한 값입니다.</p>
                      {remaining > 0 && (
                        <Button size="sm" onClick={() => setTradeListLimit(v => v + PAGE_SIZE)}>
                          <span className="num">{Math.min(remaining, PAGE_SIZE)}건 더 보기 · 남은 {remaining.toLocaleString()}건</span>
                        </Button>
                      )}
                    </div>
                  </>
                ))}
              </Section>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
