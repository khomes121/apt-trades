'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import RegionSelector from '@/components/RegionSelector';
import {
  Badge, Button, Card, CardTitle, Chip, EmptyState, ErrorBox, Label, Page, PageHeader,
  Segmented, Skeleton, Spinner, Stat, TableWrap, cx,
} from '@/components/ui';
import { formatArea, formatKDate, formatPrice, formatShortDate, toPyeong, toYmd } from '@/lib/format';
import type { Region } from '@/types';

// ── 타입 ────────────────────────────────────────────────────────────────────

interface VillaTrade {
  id: number;
  mhouse_nm: string | null;
  sgg_cd: string;
  sgg_nm: string | null;
  sido_nm: string | null;
  umd_nm: string | null;
  jibun: string | null;
  house_type: string | null;
  build_year: number | null;
  exclu_use_ar: number;
  land_ar: number | null;
  floor: number | null;
  deal_amount: number;
  deal_date: string;
  dealing_gbn: string | null;
  cdeal_type: string | null;
  lat: number | null;
  lng: number | null;
}

type HouseType = '' | '연립' | '다세대';

interface Cond {
  sggCodes: string[];
  dateFrom: string;
  dateTo: string;
  /** 고른 기간 프리셋(개월). 날짜를 직접 고쳤으면 null */
  period: number | null;
  houseType: HouseType;
  q: string;
  priceMin?: number;
  priceMax?: number;
  buildYearFrom?: number;
  buildYearTo?: number;
  areaMin?: number;
  areaMax?: number;
  excludeCancelled: boolean;
  excludeDirect: boolean;
}

type SortKey = 'deal_date' | 'name' | 'area' | 'land' | 'floor' | 'build_year' | 'price' | 'ppm';
type SortDir = 'asc' | 'desc';
type ViewMode = 'list' | 'group';
type GroupSort = 'count' | 'latest' | 'price';

interface BuildingGroup {
  key: string;
  name: string;
  address: string;
  mapQuery: string | null;
  houseType: string | null;
  buildYear: number | null;
  trades: VillaTrade[];
  count: number;
  min: number;
  max: number;
  avg: number;
  latest: VillaTrade;
}

// ── 상수 ────────────────────────────────────────────────────────────────────

const PERIOD_PRESETS = [
  { label: '3개월', months: 3 },
  { label: '6개월', months: 6 },
  { label: '1년', months: 12 },
  { label: '2년', months: 24 },
  { label: '3년', months: 36 },
  { label: '전체', months: 0 },
];
const PRICE_PRESETS = [3000, 5000, 7000, 10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 100000, 150000, 200000];
const AREA_PRESETS = [10, 20, 30, 40, 50, 60, 70, 85, 100, 120];
const BUILD_YEAR_PRESETS = [1970, 1975, 1980, 1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025];
const RECENT_YEAR_PRESETS = [5, 10, 15, 20, 30, 40];

const PAGE_SIZE = 50;
const GROUP_PAGE_SIZE = 30;
const FETCH_LIMIT = 2000;
const PYEONG = 3.305785;
const THIS_YEAR = new Date().getFullYear();

const HOUSE_TYPE_OPTIONS: Array<{ value: 'all' | '연립' | '다세대'; label: string }> = [
  { value: 'all', label: '전체' },
  { value: '연립', label: '연립' },
  { value: '다세대', label: '다세대' },
];

/** 첫 화면의 예시 — 한 번 눌러 바로 검색한다 */
const EXAMPLES: Array<{ label: string; sido: string; sgg: string; patch: Partial<Cond> }> = [
  { label: '서울 강서구 · 다세대 · 최근 1년', sido: '서울', sgg: '강서구', patch: { houseType: '다세대' } },
  { label: '부산 해운대구 · 3억 이하', sido: '부산', sgg: '해운대구', patch: { priceMax: 30000 } },
  { label: '인천 미추홀구 · 10년 이내 신축', sido: '인천', sgg: '미추홀구', patch: { buildYearFrom: THIS_YEAR - 10 } },
];

// ── 도우미 ──────────────────────────────────────────────────────────────────

function priceLabel(v: number): string {
  return v >= 10000 ? `${v / 10000}억` : `${v / 1000}천`;
}
function yearLabel(y: number): string {
  return `${String(y).slice(2)}년`;
}

function getDateRange(months: number) {
  const today = new Date();
  if (months === 0) return { dateFrom: '2006-01-01', dateTo: toYmd(today) };
  const from = new Date(today);
  from.setMonth(from.getMonth() - months);
  return { dateFrom: toYmd(from), dateTo: toYmd(today) };
}

function defaultCond(sggCodes: string[] = []): Cond {
  return {
    sggCodes, ...getDateRange(12), period: 12, houseType: '', q: '',
    excludeCancelled: true, excludeDirect: false,
  };
}

function isCancelled(r: VillaTrade) { return r.cdeal_type === 'Y'; }

/** ㎡당 가격 (만원) */
function ppm(r: VillaTrade): number | null {
  return r.exclu_use_ar > 0 ? r.deal_amount / r.exclu_use_ar : null;
}

function formatPpm(v: number | null): string {
  return v == null ? '-' : formatPrice(Math.round(v));
}

/** 'YYYY-MM-DD' → 'YY.MM.DD' */
function shortYmd(ymd: string): string {
  return `${ymd.slice(2, 4)}.${formatShortDate(ymd)}`;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function sortValue(r: VillaTrade, key: SortKey): string | number | null {
  switch (key) {
    case 'deal_date': return r.deal_date;
    case 'name': return r.mhouse_nm || null;
    case 'area': return r.exclu_use_ar;
    case 'land': return r.land_ar;
    case 'floor': return r.floor;
    case 'build_year': return r.build_year;
    case 'price': return r.deal_amount;
    case 'ppm': return ppm(r);
  }
}

function csvCell(v: string | number | null | undefined): string {
  if (v == null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`; // 스프레드시트 수식으로 읽히지 않게
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── 작은 부품 ───────────────────────────────────────────────────────────────

function Chevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg className={cx('transition-transform', open && 'rotate-180', className)} width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function MapLink({ query, label = '지도' }: { query: string; label?: string }) {
  return (
    <a
      href={`https://map.naver.com/p/search/${encodeURIComponent(query)}`}
      target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" />
      </svg>
      {label}
    </a>
  );
}

function TypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-ink-3">-</span>;
  return <Badge tone={type === '연립' ? 'brand' : type === '다세대' ? 'ok' : 'neutral'}>{type}</Badge>;
}

function DealFlags({ r }: { r: VillaTrade }) {
  return (
    <>
      {isCancelled(r) && <Badge tone="up">해제</Badge>}
      {r.dealing_gbn === '직거래' && <Badge tone="warn">직거래</Badge>}
    </>
  );
}

function RemovableChip({ children, onRemove }: { children: ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 max-w-full rounded-full bg-brand-soft text-brand text-xs font-semibold pl-2.5 pr-1 py-1">
      <span className="truncate">{children}</span>
      <button type="button" onClick={onRemove} aria-label="조건 지우기"
        className="shrink-0 h-4 w-4 inline-flex items-center justify-center rounded-full hover:bg-brand hover:text-brand-ink transition-colors cursor-pointer">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </span>
  );
}

function SortTh({ k, sort, onSort, children, right }: {
  k: SortKey; sort: { key: SortKey; dir: SortDir }; onSort: (k: SortKey) => void; children: ReactNode; right?: boolean;
}) {
  const active = sort.key === k;
  return (
    <th className={right ? '!text-right' : undefined} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(k)}
        className={cx('inline-flex items-center gap-0.5 font-semibold cursor-pointer hover:text-ink transition-colors', active && 'text-brand')}>
        {children}
        <span className={cx('num text-[0.65rem]', active ? 'opacity-100' : 'opacity-30')} aria-hidden>
          {active && sort.dir === 'asc' ? '▲' : '▼'}
        </span>
      </button>
    </th>
  );
}

/** 최소~최대 한 쌍 (프리셋 칩 + 직접 입력) */
function RangeBlock({
  title, summary, presets, presetLabel, min, max, onMin, onMax, placeholder, step, minLabel, maxLabel, onEnter, top,
}: {
  title: string; summary: string; presets: number[]; presetLabel: (v: number) => string;
  min?: number; max?: number; onMin: (v?: number) => void; onMax: (v?: number) => void;
  placeholder: string; step?: number; minLabel: string; maxLabel: string;
  onEnter: (e: KeyboardEvent<HTMLInputElement>) => void; top?: ReactNode;
}) {
  const sides = [
    { label: minLabel, value: min, set: onMin },
    { label: maxLabel, value: max, set: onMax },
  ];
  return (
    <div>
      <Label hint={<span className="num">{summary}</span>}>{title}</Label>
      {top}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {sides.map(s => (
          <div key={s.label} className="min-w-0">
            <div className="text-xs font-medium text-ink-3 mb-1.5">{s.label}</div>
            <div className="flex flex-wrap gap-1 mb-2">
              {presets.map(v => (
                <Chip key={v} size="sm" active={s.value === v} onClick={() => s.set(s.value === v ? undefined : v)}>
                  <span className="num">{presetLabel(v)}</span>
                </Chip>
              ))}
              <Chip size="sm" onClick={() => s.set(undefined)} className="!text-ink-3">없음</Chip>
            </div>
            <input
              type="number" inputMode="numeric" placeholder={placeholder} step={step}
              value={s.value ?? ''} onKeyDown={onEnter} aria-label={`${title} ${s.label}`}
              onChange={e => s.set(e.target.value ? Number(e.target.value) : undefined)}
              className="field num"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 페이지 ──────────────────────────────────────────────────────────────────

export default function VillaPage() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(true);

  const [cond, setCond] = useState<Cond>(() => defaultCond());
  const [regionOpen, setRegionOpen] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);

  const [results, setResults] = useState<VillaTrade[] | null>(null);
  const [searchedKey, setSearchedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<ViewMode>('list');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'deal_date', dir: 'desc' });
  const [groupSort, setGroupSort] = useState<GroupSort>('count');
  const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);
  const [groupLimit, setGroupLimit] = useState(GROUP_PAGE_SIZE);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());

  const reqSeq = useRef(0);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch('/api/regions')
      .then(r => r.json())
      .then((data: Region[]) => setRegions(data))
      .catch(() => setError('지역 정보를 불러오지 못했습니다.'))
      .finally(() => setRegionsLoading(false));
  }, []);

  const regionMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of regions) map[r.sgg_cd] = `${r.sido_nm} ${r.sgg_nm}`;
    return map;
  }, [regions]);

  function patch(p: Partial<Cond>) { setCond(c => ({ ...c, ...p })); }

  function applyPeriod(months: number) { patch({ ...getDateRange(months), period: months }); }

  /** 지역은 그대로 두고 나머지 조건만 처음으로 */
  function reset() { setCond(c => defaultCond(c.sggCodes)); }

  function regionName(r: VillaTrade): string {
    return regionMap[r.sgg_cd] ?? ([r.sido_nm, r.sgg_nm].filter(Boolean).join(' ') || r.sgg_cd);
  }
  function addressOf(r: VillaTrade): string {
    return [regionName(r), r.umd_nm, r.jibun].filter(Boolean).join(' ');
  }
  /** 좌표가 있는 거래만 지도 링크를 단다 */
  function mapQueryOf(r: VillaTrade): string | null {
    if (r.lat == null || r.lng == null) return null;
    return `${regionMap[r.sgg_cd] ?? [r.sido_nm, r.sgg_nm].filter(Boolean).join(' ')} ${r.umd_nm ?? ''} ${r.jibun ?? ''}`.trim();
  }

  async function runSearch(c: Cond) {
    if (c.sggCodes.length === 0 && !c.q.trim()) {
      setError('지역을 선택하거나 검색어를 입력해 주세요.');
      return;
    }
    if (c.dateFrom && c.dateTo && c.dateFrom > c.dateTo) {
      setError('조회 기간의 시작일이 종료일보다 늦습니다.');
      return;
    }
    const seq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    setResults(null);
    setDisplayLimit(PAGE_SIZE);
    setGroupLimit(GROUP_PAGE_SIZE);
    setOpenGroups(new Set());
    try {
      const res = await fetch('/api/villa/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sgg_codes: c.sggCodes,
          date_from: c.dateFrom,
          date_to: c.dateTo,
          house_type: c.houseType || undefined,
          q: c.q.trim() || undefined,
          price_min: c.priceMin,
          price_max: c.priceMax,
          build_year_from: c.buildYearFrom,
          build_year_to: c.buildYearTo,
          area_min: c.areaMin,
          area_max: c.areaMax,
          exclude_cancelled: c.excludeCancelled,
          exclude_direct: c.excludeDirect,
          limit: FETCH_LIMIT,
        }),
      });
      const json = await res.json() as { results?: VillaTrade[]; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? '검색에 실패했습니다.');
      if (seq !== reqSeq.current) return;
      setResults(json.results ?? []);
      setSearchedKey(JSON.stringify(c));
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setError(e instanceof Error ? e.message : '검색 중 오류가 발생했습니다.');
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }

  function handleSearch() { void runSearch(cond); }

  function onEnter(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSearch();
    }
  }

  function runExample(ex: (typeof EXAMPLES)[number]) {
    const region = regions.find(r => r.sido_nm.includes(ex.sido) && r.sgg_nm === ex.sgg);
    if (!region) {
      setError('예시 지역을 찾지 못했습니다. 지역을 직접 골라 검색해 주세요.');
      return;
    }
    const next: Cond = { ...defaultCond([region.sgg_cd]), ...ex.patch };
    setCond(next);
    if (ex.patch.priceMax != null || ex.patch.buildYearFrom != null) setDetailOpen(true);
    void runSearch(next);
  }

  // ── 조건 요약 칩 ──────────────────────────────────────────────────────────
  const activeChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; remove: () => void }> = [];
    const set = (p: Partial<Cond>) => () => setCond(c => ({ ...c, ...p }));
    if (cond.q.trim()) chips.push({ key: 'q', label: `검색어 "${cond.q.trim()}"`, remove: set({ q: '' }) });
    if (cond.sggCodes.length > 0 && cond.sggCodes.length <= 3) {
      for (const code of cond.sggCodes) {
        chips.push({
          key: `sgg-${code}`, label: regionMap[code] ?? code,
          remove: () => setCond(c => ({ ...c, sggCodes: c.sggCodes.filter(x => x !== code) })),
        });
      }
    } else if (cond.sggCodes.length > 3) {
      chips.push({ key: 'sgg', label: `지역 ${cond.sggCodes.length}곳`, remove: set({ sggCodes: [] }) });
    }
    if (cond.houseType) chips.push({ key: 'type', label: cond.houseType, remove: set({ houseType: '' }) });
    if (cond.priceMin != null || cond.priceMax != null) {
      chips.push({
        key: 'price',
        label: `매매가 ${cond.priceMin != null ? formatPrice(cond.priceMin) : ''} ~ ${cond.priceMax != null ? formatPrice(cond.priceMax) : ''}`.trim(),
        remove: set({ priceMin: undefined, priceMax: undefined }),
      });
    }
    if (cond.areaMin != null || cond.areaMax != null) {
      chips.push({
        key: 'area',
        label: `전용 ${cond.areaMin != null ? `${cond.areaMin}㎡` : ''} ~ ${cond.areaMax != null ? `${cond.areaMax}㎡` : ''}`.trim(),
        remove: set({ areaMin: undefined, areaMax: undefined }),
      });
    }
    if (cond.buildYearFrom != null || cond.buildYearTo != null) {
      chips.push({
        key: 'year',
        label: `건축 ${cond.buildYearFrom != null ? `${cond.buildYearFrom}년` : ''} ~ ${cond.buildYearTo != null ? `${cond.buildYearTo}년` : ''}`.trim(),
        remove: set({ buildYearFrom: undefined, buildYearTo: undefined }),
      });
    }
    if (!cond.excludeCancelled) chips.push({ key: 'cancel', label: '해제거래 포함', remove: set({ excludeCancelled: true }) });
    if (cond.excludeDirect) chips.push({ key: 'direct', label: '직거래 제외', remove: set({ excludeDirect: false }) });
    return chips;
  }, [cond, regionMap]);

  const detailCount =
    (cond.priceMin != null || cond.priceMax != null ? 1 : 0) +
    (cond.areaMin != null || cond.areaMax != null ? 1 : 0) +
    (cond.buildYearFrom != null || cond.buildYearTo != null ? 1 : 0) +
    (!cond.excludeCancelled ? 1 : 0) + (cond.excludeDirect ? 1 : 0);

  const stale = results !== null && searchedKey !== null && searchedKey !== JSON.stringify(cond);

  // ── 결과 가공 ─────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    if (!results || results.length === 0) return null;
    const valid = results.filter(r => !isCancelled(r));
    const base = valid.length > 0 ? valid : results;
    const amounts = base.map(r => r.deal_amount);
    const ppms = base.map(ppm).filter((v): v is number => v != null);
    const avgPpm = ppms.length ? ppms.reduce((s, v) => s + v, 0) / ppms.length : null;
    const top = base.reduce((a, b) => (b.deal_amount > a.deal_amount ? b : a));
    const buildings = new Set(results.map(r => `${r.sgg_cd}|${r.umd_nm ?? ''}|${r.jibun ?? ''}|${r.mhouse_nm ?? ''}`)).size;
    return {
      total: results.length,
      cancelled: results.length - valid.length,
      buildings,
      avgAmount: Math.round(amounts.reduce((s, v) => s + v, 0) / amounts.length),
      medianAmount: Math.round(median(amounts)),
      avgPpm,
      avgPerPyeong: avgPpm != null ? avgPpm * PYEONG : null,
      top,
    };
  }, [results]);

  const sorted = useMemo(() => {
    if (!results) return [];
    const mul = sort.dir === 'asc' ? 1 : -1;
    return [...results].sort((a, b) => {
      const va = sortValue(a, sort.key), vb = sortValue(b, sort.key);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // 빈 값은 늘 뒤로
      if (vb == null) return -1;
      const cmp = typeof va === 'string' || typeof vb === 'string'
        ? String(va).localeCompare(String(vb), 'ko')
        : va - vb;
      return cmp !== 0 ? cmp * mul : b.deal_date.localeCompare(a.deal_date);
    });
  }, [results, sort]);

  const groups = useMemo<BuildingGroup[]>(() => {
    if (!results) return [];
    const map = new Map<string, VillaTrade[]>();
    for (const r of results) {
      const key = `${r.sgg_cd}|${r.umd_nm ?? ''}|${r.jibun ?? ''}|${r.mhouse_nm ?? ''}`;
      const arr = map.get(key);
      if (arr) arr.push(r); else map.set(key, [r]);
    }
    const list: BuildingGroup[] = [];
    for (const [key, arr] of map) {
      const trades = [...arr].sort((a, b) => b.deal_date.localeCompare(a.deal_date) || b.deal_amount - a.deal_amount);
      const valid = trades.filter(t => !isCancelled(t));
      const base = valid.length > 0 ? valid : trades;
      const amounts = base.map(t => t.deal_amount);
      const head = trades[0];
      const withCoord = trades.find(t => t.lat != null && t.lng != null);
      list.push({
        key,
        name: head.mhouse_nm || '(건물명 없음)',
        address: [regionMap[head.sgg_cd] ?? ([head.sido_nm, head.sgg_nm].filter(Boolean).join(' ') || head.sgg_cd), head.umd_nm, head.jibun].filter(Boolean).join(' '),
        mapQuery: withCoord
          ? `${regionMap[withCoord.sgg_cd] ?? [withCoord.sido_nm, withCoord.sgg_nm].filter(Boolean).join(' ')} ${withCoord.umd_nm ?? ''} ${withCoord.jibun ?? ''}`.trim()
          : null,
        houseType: head.house_type,
        buildYear: trades.find(t => t.build_year != null)?.build_year ?? null,
        trades,
        count: trades.length,
        min: Math.min(...amounts),
        max: Math.max(...amounts),
        avg: Math.round(amounts.reduce((s, v) => s + v, 0) / amounts.length),
        latest: base[0],
      });
    }
    list.sort((a, b) => {
      if (groupSort === 'count') return b.count - a.count || b.latest.deal_date.localeCompare(a.latest.deal_date);
      if (groupSort === 'price') return b.max - a.max;
      return b.latest.deal_date.localeCompare(a.latest.deal_date) || b.count - a.count;
    });
    return list;
  }, [results, regionMap, groupSort]);

  function toggleSort(key: SortKey) {
    setSort(s => (s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'name' ? 'asc' : 'desc' }));
    setDisplayLimit(PAGE_SIZE);
  }

  function toggleGroup(key: string) {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function downloadCsv() {
    if (!results || results.length === 0) return;
    const header = ['계약일', '시도', '시군구', '읍면동', '지번', '건물명', '유형', '전용면적(㎡)', '전용면적(평)',
      '대지면적(㎡)', '층', '건축년도', '거래가(만원)', '㎡당가(만원)', '평당가(만원)', '거래유형', '해제여부'];
    const lines = sorted.map(r => {
      const p = ppm(r);
      return [
        r.deal_date, r.sido_nm, r.sgg_nm, r.umd_nm, r.jibun, r.mhouse_nm, r.house_type,
        r.exclu_use_ar, toPyeong(r.exclu_use_ar), r.land_ar, r.floor, r.build_year, r.deal_amount,
        p != null ? Math.round(p) : null, p != null ? Math.round(p * PYEONG) : null,
        r.dealing_gbn, isCancelled(r) ? '해제' : '',
      ].map(csvCell).join(',');
    });
    const blob = new Blob([`﻿${[header.join(','), ...lines].join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `빌라실거래_${cond.dateFrom}_${cond.dateTo}_${results.length}건.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const shown = sorted.slice(0, displayLimit);
  const shownGroups = groups.slice(0, groupLimit);

  return (
    <Page>
      <PageHeader
        eyebrow="연립·다세대"
        title="빌라 실거래"
        desc="연립·다세대 실거래를 건물명·동·지번으로 찾고, 같은 건물의 거래를 묶어 가격 범위를 한눈에 봅니다."
      />

      {/* ── 검색 조건 ─────────────────────────────────────────────────────── */}
      <Card>
        <CardTitle
          sub="지역을 고르거나 검색어를 입력한 뒤 검색을 누르세요. 입력칸에서 Enter 를 눌러도 됩니다."
          right={<Button variant="ghost" size="sm" onClick={reset}>조건 초기화</Button>}
        >
          검색 조건
        </CardTitle>

        <div className="space-y-6">
          {/* 검색어 + 검색 버튼 */}
          <div>
            <Label hint="띄어 쓰면 모두 포함한 거래만 찾습니다">건물명 · 동 · 지번</Label>
            <div className="flex gap-2">
              <div className="relative flex-1 min-w-0">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" width="16" height="16" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
                </svg>
                <input
                  type="text" value={cond.q} onChange={e => patch({ q: e.target.value })} onKeyDown={onEnter}
                  placeholder="예: 우동 또는 청운빌라" aria-label="건물명, 동, 지번 검색"
                  className="field !pl-9 !py-2.5"
                />
              </div>
              <Button variant="primary" onClick={handleSearch} disabled={loading} className="shrink-0 !px-5 sm:!px-7">
                {loading && <Spinner />}
                {loading ? '검색 중' : '검색'}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-6 lg:gap-8">
            {/* 지역 */}
            <div className="min-w-0">
              <div className="flex items-start justify-between gap-2">
                <Label hint={cond.sggCodes.length > 0 ? `${cond.sggCodes.length}곳 선택` : '검색어만으로도 찾을 수 있습니다'}>지역</Label>
                <button type="button" onClick={() => setRegionOpen(o => !o)} aria-expanded={regionOpen}
                  className="inline-flex items-center gap-0.5 text-xs font-semibold text-ink-3 hover:text-ink cursor-pointer">
                  {regionOpen ? '접기' : '펼치기'}<Chevron open={regionOpen} />
                </button>
              </div>
              {regionOpen && (
                regionsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-3/4" />
                    <Skeleton className="h-48" />
                  </div>
                ) : (
                  <RegionSelector regions={regions} selectedCodes={cond.sggCodes} onChange={codes => patch({ sggCodes: codes })} />
                )
              )}
            </div>

            <div className="min-w-0 space-y-6">
              {/* 기간 */}
              <div>
                <Label hint="계약일 기준">조회 기간</Label>
                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  {PERIOD_PRESETS.map(p => (
                    <Chip key={p.months} active={cond.period === p.months} onClick={() => applyPeriod(p.months)}>{p.label}</Chip>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input type="date" value={cond.dateFrom} max={cond.dateTo || undefined} aria-label="시작일" suppressHydrationWarning
                    onChange={e => patch({ dateFrom: e.target.value, period: null })} onKeyDown={onEnter} className="field num" />
                  <span className="text-ink-3 shrink-0">~</span>
                  <input type="date" value={cond.dateTo} min={cond.dateFrom || undefined} aria-label="종료일" suppressHydrationWarning
                    onChange={e => patch({ dateTo: e.target.value, period: null })} onKeyDown={onEnter} className="field num" />
                </div>
              </div>

              {/* 유형 */}
              <div>
                <Label>유형</Label>
                <Segmented
                  value={cond.houseType === '' ? 'all' : cond.houseType}
                  options={HOUSE_TYPE_OPTIONS}
                  onChange={v => patch({ houseType: v === 'all' ? '' : v })}
                />
              </div>
            </div>
          </div>

          {/* 상세 조건 */}
          <div className="rounded-xl border border-line overflow-hidden">
            <button type="button" onClick={() => setDetailOpen(o => !o)} aria-expanded={detailOpen}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-surface-2 hover:bg-surface-3 transition-colors cursor-pointer text-left">
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-semibold text-ink">상세 조건</span>
                {detailCount > 0
                  ? <Badge tone="brand"><span className="num">{detailCount}</span>개 적용</Badge>
                  : <span className="text-xs text-ink-3 truncate">가격 · 면적 · 건축년도 · 해제/직거래</span>}
              </span>
              <Chevron open={detailOpen} className="text-ink-3 shrink-0" />
            </button>
            {detailOpen && (
              <div className="p-4 sm:p-5 space-y-6 border-t border-line rise">
                <RangeBlock
                  title="매매가"
                  summary={`${cond.priceMin != null ? formatPrice(cond.priceMin) : '하한 없음'} ~ ${cond.priceMax != null ? formatPrice(cond.priceMax) : '상한 없음'}`}
                  presets={PRICE_PRESETS} presetLabel={priceLabel}
                  min={cond.priceMin} max={cond.priceMax}
                  onMin={v => patch({ priceMin: v })} onMax={v => patch({ priceMax: v })}
                  placeholder="직접 입력 (만원)" step={1000} minLabel="최소 (이상)" maxLabel="최대 (이하)" onEnter={onEnter}
                />
                <RangeBlock
                  title="전용면적"
                  summary={`${cond.areaMin != null ? `${cond.areaMin}㎡ (${toPyeong(cond.areaMin)}평)` : '하한 없음'} ~ ${cond.areaMax != null ? `${cond.areaMax}㎡ (${toPyeong(cond.areaMax)}평)` : '상한 없음'}`}
                  presets={AREA_PRESETS} presetLabel={v => `${v}㎡`}
                  min={cond.areaMin} max={cond.areaMax}
                  onMin={v => patch({ areaMin: v })} onMax={v => patch({ areaMax: v })}
                  placeholder="직접 입력 (㎡)" step={1} minLabel="최소 (이상)" maxLabel="최대 (이하)" onEnter={onEnter}
                />
                <RangeBlock
                  title="건축년도"
                  summary={`${cond.buildYearFrom ?? '하한 없음'} ~ ${cond.buildYearTo ?? '상한 없음'}`}
                  presets={BUILD_YEAR_PRESETS} presetLabel={yearLabel}
                  min={cond.buildYearFrom} max={cond.buildYearTo}
                  onMin={v => patch({ buildYearFrom: v })} onMax={v => patch({ buildYearTo: v })}
                  placeholder="직접 입력 (연도)" minLabel="시작 (이후)" maxLabel="종료 (이전)" onEnter={onEnter}
                  top={(
                    <div className="flex flex-wrap items-center gap-1.5 mb-3">
                      <span className="text-xs font-medium text-ink-3 mr-0.5">최근</span>
                      {RECENT_YEAR_PRESETS.map(y => {
                        const fromYear = THIS_YEAR - y;
                        const active = cond.buildYearFrom === fromYear && cond.buildYearTo == null;
                        return (
                          <Chip key={y} size="sm" active={active}
                            onClick={() => patch(active ? { buildYearFrom: undefined } : { buildYearFrom: fromYear, buildYearTo: undefined })}>
                            <span className="num">{y}</span>년 이내
                          </Chip>
                        );
                      })}
                    </div>
                  )}
                />
                <div>
                  <Label>거래 제외</Label>
                  <div className="flex flex-wrap gap-x-6 gap-y-2.5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={cond.excludeCancelled} className="w-4 h-4"
                        onChange={e => patch({ excludeCancelled: e.target.checked })} />
                      <span className="text-sm text-ink">해제거래 제외 <span className="text-ink-3">(권장)</span></span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={cond.excludeDirect} className="w-4 h-4"
                        onChange={e => patch({ excludeDirect: e.target.checked })} />
                      <span className="text-sm text-ink">직거래 제외</span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 적용 중인 조건 */}
          {activeChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-ink-3 mr-1">적용 조건</span>
              {activeChips.map(c => <RemovableChip key={c.key} onRemove={c.remove}>{c.label}</RemovableChip>)}
            </div>
          )}
        </div>
      </Card>

      {error && <ErrorBox>{error}</ErrorBox>}

      {/* ── 결과 ──────────────────────────────────────────────────────────── */}
      <div ref={resultsRef} className="space-y-6 scroll-mt-20">
        {loading ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[6.5rem] !rounded-2xl" />)}
            </div>
            <Card>
              <div className="space-y-3">
                <Skeleton className="h-8 w-56" />
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
              </div>
            </Card>
          </>
        ) : results === null ? (
          <Card>
            <EmptyState
              icon="🏘️"
              title="지역이나 검색어를 넣고 검색해 보세요"
              desc="지역만 골라도, 건물명·동·지번만 입력해도 됩니다. 아래 예시를 누르면 바로 결과를 볼 수 있습니다."
            />
            <div className="-mt-8 pb-8 flex flex-wrap justify-center gap-2 px-2">
              {EXAMPLES.map(ex => (
                <Chip key={ex.label} disabled={regionsLoading} onClick={() => runExample(ex)} className="disabled:opacity-50 disabled:cursor-not-allowed">
                  {ex.label}
                </Chip>
              ))}
            </div>
          </Card>
        ) : results.length === 0 ? (
          <Card>
            <EmptyState
              title="조건에 맞는 거래가 없습니다"
              desc="조회 기간을 늘리거나 상세 조건을 줄여 다시 검색해 보세요. 검색어는 건물명·동·지번 가운데 하나에 들어 있어야 합니다."
            />
          </Card>
        ) : (
          <>
            {summary && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 rise">
                <Stat
                  label="거래건수" value={summary.total.toLocaleString()} unit="건"
                  hint={summary.total >= FETCH_LIMIT
                    ? `최근 ${FETCH_LIMIT.toLocaleString()}건까지만 불러옵니다`
                    : `건물 ${summary.buildings.toLocaleString()}곳${summary.cancelled > 0 ? ` · 해제 ${summary.cancelled.toLocaleString()}건 포함` : ''}`}
                />
                <Stat label="평균 거래가" value={formatPrice(summary.avgAmount)} hint={`중위 ${formatPrice(summary.medianAmount)}`} />
                <Stat
                  label="평균 ㎡당가" value={formatPpm(summary.avgPpm)}
                  hint={summary.avgPerPyeong != null ? `평당 ${formatPrice(Math.round(summary.avgPerPyeong))} · 전용면적 기준` : undefined}
                />
                <Stat
                  label="최고가" value={formatPrice(summary.top.deal_amount)}
                  hint={`${summary.top.mhouse_nm || summary.top.umd_nm || '건물명 없음'} · ${formatShortDate(summary.top.deal_date)}`}
                />
              </div>
            )}

            <Card className="rise">
              <CardTitle
                sub={(
                  <>
                    {stale && <span className="text-warn font-semibold">조건이 바뀌었습니다. 다시 검색해야 반영됩니다. · </span>}
                    {view === 'list'
                      ? <>전체 <span className="num">{results.length.toLocaleString()}</span>건 가운데 <span className="num">{Math.min(displayLimit, results.length).toLocaleString()}</span>건 표시 · 머리글을 누르면 정렬됩니다</>
                      : <>같은 지번·같은 건물명의 거래를 묶었습니다 · 건물 <span className="num">{groups.length.toLocaleString()}</span>곳</>}
                  </>
                )}
                right={(
                  <div className="flex flex-wrap items-center gap-2">
                    <Segmented<ViewMode> value={view} onChange={setView} size="sm"
                      options={[{ value: 'list', label: '거래 목록' }, { value: 'group', label: '건물별 묶음' }]} />
                    <Button size="sm" onClick={downloadCsv}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
                      </svg>
                      CSV 내려받기
                    </Button>
                  </div>
                )}
              >
                검색 결과
              </CardTitle>

              {view === 'list' ? (
                <>
                  {/* 모바일 정렬 */}
                  <div className="md:hidden flex items-center gap-2 mb-3">
                    <select
                      value={sort.key} aria-label="정렬 기준"
                      onChange={e => { setSort(s => ({ ...s, key: e.target.value as SortKey })); setDisplayLimit(PAGE_SIZE); }}
                      className="field !w-auto flex-1"
                    >
                      <option value="deal_date">계약일</option>
                      <option value="price">거래가</option>
                      <option value="ppm">㎡당가</option>
                      <option value="area">전용면적</option>
                      <option value="build_year">건축년도</option>
                      <option value="floor">층</option>
                      <option value="name">건물명</option>
                    </select>
                    <Segmented<SortDir> value={sort.dir} size="sm" onChange={dir => setSort(s => ({ ...s, dir }))}
                      options={[{ value: 'desc', label: '내림차순' }, { value: 'asc', label: '오름차순' }]} />
                  </div>

                  {/* 모바일 카드 */}
                  <ul className="md:hidden rounded-xl border border-line divide-y divide-line overflow-hidden">
                    {shown.map(r => {
                      const mq = mapQueryOf(r);
                      return (
                        <li key={r.id} className="p-3.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-semibold text-ink break-all">{r.mhouse_nm || '(건물명 없음)'}</span>
                                <TypeBadge type={r.house_type} />
                                <DealFlags r={r} />
                              </div>
                              <div className="mt-0.5 text-xs text-ink-2 break-keep">{addressOf(r)}</div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className={cx('num font-bold', isCancelled(r) ? 'line-through text-ink-3' : 'text-ink')}>{formatPrice(r.deal_amount)}</div>
                              <div className="num text-xs text-ink-3">㎡당 {formatPpm(ppm(r))}</div>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-2">
                            <span className="num">{r.deal_date}</span>
                            <span className="num">{formatArea(r.exclu_use_ar)}</span>
                            {r.land_ar != null && <span className="num">대지 {Number(r.land_ar.toFixed(1))}㎡</span>}
                            {r.floor != null && <span className="num">{r.floor}층</span>}
                            {r.build_year != null && <span className="num">{r.build_year}년</span>}
                            {mq && <span className="ml-auto"><MapLink query={mq} /></span>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {/* 데스크톱 표 */}
                  <div className="hidden md:block">
                    <TableWrap maxH="70vh">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <SortTh sort={sort} onSort={toggleSort} k="deal_date">계약일</SortTh>
                            <SortTh sort={sort} onSort={toggleSort} k="name">건물명</SortTh>
                            <th>지역 / 지번</th>
                            <th>유형</th>
                            <SortTh sort={sort} onSort={toggleSort} k="area" right>전용면적</SortTh>
                            <SortTh sort={sort} onSort={toggleSort} k="land" right>대지면적</SortTh>
                            <SortTh sort={sort} onSort={toggleSort} k="floor" right>층</SortTh>
                            <SortTh sort={sort} onSort={toggleSort} k="build_year" right>건축년도</SortTh>
                            <SortTh sort={sort} onSort={toggleSort} k="price" right>거래가</SortTh>
                            <SortTh sort={sort} onSort={toggleSort} k="ppm" right>㎡당가</SortTh>
                            <th className="!text-center">지도</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shown.map(r => {
                            const mq = mapQueryOf(r);
                            return (
                              <tr key={r.id}>
                                <td className="num text-ink-2">{r.deal_date}</td>
                                <td>
                                  <span className="inline-flex items-center gap-1.5">
                                    <span className="font-semibold text-ink">{r.mhouse_nm || <span className="font-normal text-ink-3">(건물명 없음)</span>}</span>
                                    <DealFlags r={r} />
                                  </span>
                                </td>
                                <td>
                                  <div className="text-ink-2">{regionName(r)} {r.umd_nm ?? ''}</div>
                                  <div className="num text-xs text-ink-3">{r.jibun || '-'}</div>
                                </td>
                                <td><TypeBadge type={r.house_type} /></td>
                                <td className="num !text-right text-ink-2">{formatArea(r.exclu_use_ar)}</td>
                                <td className="num !text-right text-ink-2">{r.land_ar != null ? `${Number(r.land_ar.toFixed(1))}㎡` : '-'}</td>
                                <td className="num !text-right text-ink-2">{r.floor ?? '-'}</td>
                                <td className="num !text-right text-ink-2">{r.build_year ?? '-'}</td>
                                <td className={cx('num !text-right font-bold', isCancelled(r) ? 'line-through text-ink-3' : 'text-ink')}>{formatPrice(r.deal_amount)}</td>
                                <td className="num !text-right text-ink-2">{formatPpm(ppm(r))}</td>
                                <td className="!text-center">{mq ? <MapLink query={mq} /> : <span className="text-ink-3">-</span>}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </TableWrap>
                  </div>

                  {results.length > displayLimit && (
                    <div className="flex justify-center pt-4">
                      <Button onClick={() => setDisplayLimit(n => n + PAGE_SIZE)}>
                        <span className="num">{Math.min(PAGE_SIZE, results.length - displayLimit)}</span>건 더 보기
                        <span className="num text-xs font-normal text-ink-3">남은 {(results.length - displayLimit).toLocaleString()}건</span>
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="text-xs font-medium text-ink-3">정렬</span>
                    <Segmented<GroupSort> value={groupSort} size="sm"
                      onChange={v => { setGroupSort(v); setGroupLimit(GROUP_PAGE_SIZE); }}
                      options={[{ value: 'count', label: '거래 많은 순' }, { value: 'latest', label: '최근 거래 순' }, { value: 'price', label: '최고가 순' }]} />
                  </div>

                  <ul className="space-y-2">
                    {shownGroups.map(g => {
                      const open = openGroups.has(g.key);
                      return (
                        <li key={g.key} className={cx('rounded-xl border overflow-hidden transition-colors', open ? 'border-line-strong' : 'border-line')}>
                          <button type="button" onClick={() => toggleGroup(g.key)} aria-expanded={open}
                            className="w-full text-left px-3.5 sm:px-4 py-3 flex items-center gap-3 hover:bg-surface-2 transition-colors cursor-pointer">
                            <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-x-4 gap-y-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-semibold text-ink break-all">{g.name}</span>
                                  <TypeBadge type={g.houseType} />
                                  {g.buildYear != null && <span className="num text-xs text-ink-3">{g.buildYear}년</span>}
                                </div>
                                <div className="mt-0.5 text-xs text-ink-2 break-keep">{g.address}</div>
                              </div>
                              <div className="flex items-center gap-3 sm:gap-5 sm:shrink-0 sm:text-right">
                                <Badge tone="neutral"><span className="num">{g.count.toLocaleString()}</span>건</Badge>
                                <div className="min-w-0">
                                  <div className="num text-sm font-bold text-ink">
                                    {g.min === g.max ? formatPrice(g.max) : `${formatPrice(g.min)} ~ ${formatPrice(g.max)}`}
                                  </div>
                                  <div className="num text-xs text-ink-3">
                                    최근 {shortYmd(g.latest.deal_date)} · {formatPrice(g.latest.deal_amount)}
                                  </div>
                                </div>
                              </div>
                            </div>
                            <Chevron open={open} className="text-ink-3 shrink-0" />
                          </button>

                          {open && (
                            <div className="border-t border-line bg-surface-2 p-3 sm:p-4 space-y-3 rise">
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
                                <span>
                                  평균 <b className="num text-ink">{formatPrice(g.avg)}</b>
                                  <span className="text-ink-3"> · 최근 거래 {formatKDate(g.latest.deal_date, true)}</span>
                                </span>
                                {g.mapQuery && <MapLink query={g.mapQuery} label="네이버 지도에서 보기" />}
                              </div>
                              <div className="bg-surface rounded-xl">
                                <TableWrap maxH="22rem">
                                  <table className="data-table">
                                    <thead>
                                      <tr>
                                        <th>계약일</th>
                                        <th className="!text-right">전용면적</th>
                                        <th className="!text-right">층</th>
                                        <th className="!text-right">거래가</th>
                                        <th className="!text-right">㎡당가</th>
                                        <th>비고</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {g.trades.map(t => (
                                        <tr key={t.id}>
                                          <td className="num text-ink-2">{t.deal_date}</td>
                                          <td className="num !text-right text-ink-2">{formatArea(t.exclu_use_ar)}</td>
                                          <td className="num !text-right text-ink-2">{t.floor ?? '-'}</td>
                                          <td className={cx('num !text-right font-bold', isCancelled(t) ? 'line-through text-ink-3' : 'text-ink')}>{formatPrice(t.deal_amount)}</td>
                                          <td className="num !text-right text-ink-2">{formatPpm(ppm(t))}</td>
                                          <td><span className="inline-flex gap-1"><DealFlags r={t} /></span></td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </TableWrap>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>

                  {groups.length > groupLimit && (
                    <div className="flex justify-center pt-4">
                      <Button onClick={() => setGroupLimit(n => n + GROUP_PAGE_SIZE)}>
                        <span className="num">{Math.min(GROUP_PAGE_SIZE, groups.length - groupLimit)}</span>곳 더 보기
                        <span className="num text-xs font-normal text-ink-3">남은 {(groups.length - groupLimit).toLocaleString()}곳</span>
                      </Button>
                    </div>
                  )}
                </>
              )}
            </Card>
          </>
        )}
      </div>
    </Page>
  );
}
