'use client';

/**
 * 구/군 시세 동향 표 + 시세 동향 화면이 같이 쓰는 작은 부품.
 * (Sparkline · DivergingBar · SortTh 는 TrendRecommendations · UmdDrilldown 도 가져다 쓴다)
 */
import { useMemo, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { SggTrendSummary } from '@/types';
import { EmptyState, TableWrap, cx } from '@/components/ui';
import { formatPrice, formatRate, trendColor } from '@/lib/format';

// ── 표기 ────────────────────────────────────────────────────────────────────

/** 1평 = 3.3058㎡ */
export const M2_PER_PYEONG = 3.3058;

/** 만원/㎡ → '1,234.5' */
export function formatM2Price(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '-';
  return v.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** 만원/㎡ → 평당가 '4,081만' · '1억 2,000' */
export function formatPyeongPrice(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '-';
  return formatPrice(Math.round(v * M2_PER_PYEONG));
}

/** 'YYYYMM' → '25.09' */
export function ymLabel(ym: string): string {
  return `${ym.slice(2, 4)}.${ym.slice(4, 6)}`;
}

export type Tone = 'up' | 'down' | 'flat';
export function toneOf(rate: number | null | undefined): Tone {
  if (rate == null || isNaN(rate) || rate === 0) return 'flat';
  return rate > 0 ? 'up' : 'down';
}
const TONE_COLOR: Record<Tone, string> = { up: 'var(--up)', down: 'var(--down)', flat: 'var(--ink-3)' };

/**
 * 막대 눈금의 끝값. 최댓값을 그대로 쓰면 튀는 한 곳 때문에 나머지 막대가 다 납작해지므로
 * 95번째 백분위수를 쓴다 (넘는 값은 막대가 꽉 찬다).
 */
export function rateScale(rates: Array<number | null | undefined>): number {
  const abs = rates.filter((r): r is number => r != null && !isNaN(r)).map(Math.abs).sort((a, b) => a - b);
  if (abs.length === 0) return 1;
  const p95 = abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))];
  return Math.max(1, p95);
}

// ── 작은 그림 ───────────────────────────────────────────────────────────────

/** 월별 흐름을 한 줄로 보여 주는 작은 선 그림 */
export function Sparkline({ values, tone = 'flat', width = 72, height = 24, label }: {
  values: number[]; tone?: Tone; width?: number; height?: number; label?: string;
}) {
  if (values.length < 2) return <span className="text-ink-3">-</span>;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * (height - pad * 2);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const;
  });
  const last = pts[pts.length - 1];
  const color = TONE_COLOR[tone];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={label ?? '월별 추이'} className="shrink-0 overflow-visible">
      <polyline points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke={color}
        strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  );
}

/** 변동률 막대 — 가운데 기준선에서 상승은 오른쪽(빨강), 하락은 왼쪽(파랑)으로 뻗는다 */
export function DivergingBar({ value, max, className }: { value: number | null | undefined; max: number; className?: string }) {
  const v = value == null || isNaN(value) ? 0 : value;
  const half = Math.min(1, Math.abs(v) / (max || 1)) * 50;
  return (
    <span className={cx('relative inline-block h-2 w-16 shrink-0 rounded-full bg-surface-3 align-middle', className)} aria-hidden>
      {v !== 0 && (
        <span
          className={cx('absolute inset-y-0', v > 0 ? 'left-1/2 rounded-r-full bg-up' : 'right-1/2 rounded-l-full bg-down')}
          style={{ width: `max(2px, ${half}%)` }}
        />
      )}
      <span className="absolute -inset-y-0.5 left-1/2 w-px -translate-x-1/2 bg-line-strong" />
    </span>
  );
}

/** 막대 + 숫자 한 묶음 */
export function RateCell({ value, max }: { value: number | null | undefined; max: number }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <DivergingBar value={value} max={max} />
      <span className={cx('num w-14 text-right font-bold', trendColor(value))}>{formatRate(value)}</span>
    </span>
  );
}

// ── 정렬 머리글 ─────────────────────────────────────────────────────────────

export interface SortState<K extends string> { key: K; dir: 'asc' | 'desc' }

export function nextSort<K extends string>(cur: SortState<K>, key: K, firstDir: 'asc' | 'desc' = 'desc'): SortState<K> {
  if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: firstDir };
}

export function SortTh<K extends string>({ k, sort, onSort, children, right, className }: {
  k: K; sort: SortState<K>; onSort: (k: K) => void; children: ReactNode; right?: boolean; className?: string;
}) {
  const on = sort.key === k;
  return (
    <th className={cx(right && '!text-right', className)} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(k)}
        className={cx('inline-flex items-center gap-1 cursor-pointer font-semibold transition-colors hover:text-ink', on && 'text-ink')}>
        {children}
        <svg width="8" height="10" viewBox="0 0 8 10" aria-hidden className="shrink-0">
          <path d="M4 0l3 4H1z" fill="currentColor" opacity={on && sort.dir === 'asc' ? 1 : 0.28} />
          <path d="M4 10L1 6h6z" fill="currentColor" opacity={on && sort.dir === 'desc' ? 1 : 0.28} />
        </svg>
      </button>
    </th>
  );
}

// ── 구/군 표 ────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'prev' | 'curr' | 'rate' | 'amount' | 'trades';

const PICK: Record<Exclude<SortKey, 'name'>, (r: SggTrendSummary) => number> = {
  prev: r => r.prev_price,
  curr: r => r.curr_price,
  rate: r => r.change_rate,
  amount: r => r.change_amount,
  trades: r => r.trade_count,
};

interface Props {
  rows: SggTrendSummary[];
  /** 행을 누르면 그 구/군의 동별 동향을 연다 */
  onRowClick: (row: SggTrendSummary) => void;
  /** 막대 눈금 끝값(%) — 안 주면 rows 에서 계산한다. 필터를 바꿔도 막대 길이가 흔들리지 않게 밖에서 넘긴다 */
  scaleMax?: number;
  /** 지금 열려 있는 구/군 */
  activeCd?: string | null;
  maxH?: string;
}

export default function SggTrendTable({ rows, onRowClick, scaleMax, activeCd, maxH = '36rem' }: Props) {
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'rate', dir: 'desc' });

  const sorted = useMemo(() => {
    const sign = sort.dir === 'asc' ? 1 : -1;
    const list = [...rows];
    if (sort.key === 'name') {
      list.sort((a, b) => sign * `${a.sido_nm} ${a.sgg_nm}`.localeCompare(`${b.sido_nm} ${b.sgg_nm}`, 'ko'));
    } else {
      const pick = PICK[sort.key];
      list.sort((a, b) => sign * (pick(a) - pick(b)));
    }
    return list;
  }, [rows, sort]);

  const max = scaleMax ?? rateScale(rows.map(r => r.change_rate));
  const onSort = (k: SortKey) => setSort(s => nextSort(s, k, k === 'name' ? 'asc' : 'desc'));

  if (rows.length === 0) {
    return <EmptyState title="해당하는 지역이 없습니다" desc="보기 조건이나 지역 이름 검색어를 바꿔 보세요." />;
  }

  return (
    <TableWrap maxH={maxH}>
      <table className="data-table">
        <thead>
          <tr>
            <th className="w-10 hidden sm:table-cell">#</th>
            <SortTh k="name" sort={sort} onSort={onSort}>지역</SortTh>
            <th>월별 추이</th>
            <SortTh k="prev" sort={sort} onSort={onSort} right className="hidden md:table-cell">이전 단가</SortTh>
            <SortTh k="curr" sort={sort} onSort={onSort} right>최근 단가</SortTh>
            <SortTh k="rate" sort={sort} onSort={onSort} right>변동률</SortTh>
            <SortTh k="amount" sort={sort} onSort={onSort} right className="hidden lg:table-cell">변동폭</SortTh>
            <SortTh k="trades" sort={sort} onSort={onSort} right>거래</SortTh>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr
              key={r.sgg_cd}
              tabIndex={0}
              aria-label={`${r.sido_nm} ${r.sgg_nm} 동별 동향 열기`}
              className={cx('cursor-pointer', activeCd === r.sgg_cd && '[&>td]:!bg-brand-soft')}
              onClick={() => onRowClick(r)}
              onKeyDown={(e: KeyboardEvent<HTMLTableRowElement>) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(r); }
              }}
            >
              <td className="num text-ink-3 hidden sm:table-cell">{i + 1}</td>
              <td>
                <div className="font-semibold text-ink">{r.sgg_nm}</div>
                <div className="text-xs text-ink-3">{r.sido_nm}</div>
              </td>
              <td>
                <Sparkline values={r.monthly.map(m => m.avg_m2_price)} tone={toneOf(r.change_rate)}
                  label={`${r.sgg_nm} 월별 ㎡당 단가 추이`} />
              </td>
              <td className="num !text-right text-ink-2 hidden md:table-cell">
                {formatM2Price(r.prev_price)}<span className="ml-0.5 text-xs text-ink-3">만/㎡</span>
              </td>
              <td className="!text-right">
                <div className="num font-bold text-ink">
                  {formatM2Price(r.curr_price)}<span className="ml-0.5 text-xs font-medium text-ink-3">만/㎡</span>
                </div>
                <div className="num text-xs text-ink-3">평당 {formatPyeongPrice(r.curr_price)}</div>
              </td>
              <td className="!text-right"><RateCell value={r.change_rate} max={max} /></td>
              <td className={cx('num !text-right hidden lg:table-cell', trendColor(r.change_amount))}>
                {r.change_amount > 0 ? '+' : ''}{formatM2Price(r.change_amount)}<span className="ml-0.5 text-xs text-ink-3">만</span>
              </td>
              <td className="num !text-right text-ink-2">{r.trade_count.toLocaleString()}<span className="ml-0.5 text-xs text-ink-3">건</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
