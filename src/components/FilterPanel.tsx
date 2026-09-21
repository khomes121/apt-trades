'use client';

import { useState, type ReactNode } from 'react';
import { Badge, Chip, Label, Segmented, cx } from '@/components/ui';
import { formatEok, toYmd } from '@/lib/format';
import type { SearchParams } from '@/types';

interface Props {
  params: SearchParams;
  onChange: (p: Partial<SearchParams>) => void;
  /** 단지명 칸에서 Enter 를 누르면 부른다 */
  onSubmit?: () => void;
}

export const PERIOD_PRESETS = [
  { label: '3개월', months: 3 },
  { label: '6개월', months: 6 },
  { label: '1년', months: 12 },
  { label: '2년', months: 24 },
  { label: '3년', months: 36 },
  { label: '전체', months: 0 },
];

const DIFF_PRESETS = [1000, 2000, 3000, 4000, 5000, 10000];
const RATE_PRESETS = [5, 10, 20, 30, 50];
const PRICE_PRESETS = [3000, 5000, 7000, 10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 100000, 150000, 200000];
const BUILD_YEAR_PRESETS = [1970, 1975, 1980, 1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025];
const RECENT_YEAR_PRESETS = [5, 10, 15, 20, 30, 40];

function yearLabel(y: number): string {
  return `${String(y).slice(2)}년`;
}

/** 오늘 기준 최근 N개월 (0 = 전체 기간) */
export function getDateRange(months: number): { date_from: string; date_to: string } {
  const today = new Date();
  if (months === 0) return { date_from: '2006-01-01', date_to: toYmd(today) };
  const from = new Date(today);
  from.setMonth(from.getMonth() - months);
  return { date_from: toYmd(from), date_to: toYmd(today) };
}

/** 지금 날짜 범위가 어느 기간 프리셋과 같은지 (없으면 null) */
export function matchPeriodPreset(params: Pick<SearchParams, 'date_from' | 'date_to'>) {
  return PERIOD_PRESETS.find(p => {
    const r = getDateRange(p.months);
    return r.date_from === params.date_from && r.date_to === params.date_to;
  }) ?? null;
}

function currentYear(): number {
  return new Date().getFullYear();
}

function numOrUndef(v: string): number | undefined {
  return v === '' || isNaN(Number(v)) ? undefined : Number(v);
}

// ── 작은 부품 ───────────────────────────────────────────────────────────────

function UnitInput({ value, onValue, placeholder, unit, step, min, label }: {
  value: number | undefined; onValue: (v: number | undefined) => void;
  placeholder: string; unit: string; step?: number; min?: number; label: string;
}) {
  return (
    <div className="relative min-w-0">
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        placeholder={placeholder}
        value={value ?? ''}
        step={step}
        min={min}
        onChange={e => onValue(numOrUndef(e.target.value))}
        className="field num !pr-12"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-3">{unit}</span>
    </div>
  );
}

function PresetChips({ values, current, format, onPick }: {
  values: number[]; current: number | undefined; format: (v: number) => string; onPick: (v: number | undefined) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {values.map(v => (
        <Chip key={v} size="sm" active={current === v} onClick={() => onPick(current === v ? undefined : v)}>
          <span className="num">{format(v)}</span>
        </Chip>
      ))}
    </div>
  );
}

function SubLabel({ children, onClear }: { children: ReactNode; onClear?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1.5">
      <span className="text-xs font-medium text-ink-2">{children}</span>
      {onClear && (
        <button type="button" onClick={onClear} className="text-xs text-ink-3 hover:text-brand cursor-pointer">
          지우기
        </button>
      )}
    </div>
  );
}

function CheckCard({ checked, onChange, title, desc }: {
  checked: boolean; onChange: (v: boolean) => void; title: string; desc: string;
}) {
  return (
    <label className={cx(
      'flex items-start gap-3 rounded-xl border px-3.5 py-3 cursor-pointer transition-colors',
      checked ? 'border-brand bg-brand-soft' : 'border-line hover:bg-surface-2',
    )}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-xs text-ink-3 mt-0.5">{desc}</span>
      </span>
    </label>
  );
}

// ── 패널 ────────────────────────────────────────────────────────────────────

export default function FilterPanel({ params, onChange, onSubmit }: Props) {
  // null = 화면 폭에 맡긴다 (lg 이상 펼침 · 모바일 접힘). 한 번 누르면 그 뒤로는 사용자가 정한 대로.
  const [advOpen, setAdvOpen] = useState<boolean | null>(null);

  const period = matchPeriodPreset(params);
  const thisYear = currentYear();

  const advCount =
    (params.price_min != null || params.price_max != null ? 1 : 0) +
    (params.build_year_from != null || params.build_year_to != null ? 1 : 0) +
    (params.buyer_gbn ? 1 : 0) +
    (params.min_trade_count > 1 ? 1 : 0) +
    (!params.exclude_cancelled ? 1 : 0) +
    (!(params.exclude_direct ?? false) ? 1 : 0);

  function toggleAdv() {
    const isOpen = advOpen ?? window.matchMedia('(min-width: 1024px)').matches;
    setAdvOpen(!isOpen);
  }

  const bothDiff = params.diff_amount != null && params.diff_rate != null;

  return (
    <div className="space-y-6">
      {/* 단지명 */}
      <div>
        <Label hint="동 이름과 함께 띄어 써도 됩니다">단지명</Label>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="search"
            enterKeyHint="search"
            aria-label="단지명"
            placeholder="예: 신평 현대"
            value={params.apt_nm ?? ''}
            onChange={e => onChange({ apt_nm: e.target.value || undefined })}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onSubmit?.();
              }
            }}
            className="field !pl-9"
          />
        </div>
      </div>

      {/* 조회 기간 */}
      <div>
        <Label hint="계약일 기준">조회 기간</Label>
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {PERIOD_PRESETS.map(p => (
            <Chip key={p.months} active={period?.months === p.months} onClick={() => onChange(getDateRange(p.months))}>
              {p.label}
            </Chip>
          ))}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <input type="date" aria-label="시작일" value={params.date_from} max={params.date_to}
            onChange={e => onChange({ date_from: e.target.value })} className="field num" />
          <span className="text-ink-3 text-sm">~</span>
          <input type="date" aria-label="종료일" value={params.date_to} min={params.date_from}
            onChange={e => onChange({ date_to: e.target.value })} className="field num" />
        </div>
      </div>

      {/* 변동 조건 */}
      <div>
        <Label hint="같은 단지·평형의 최고가 − 최저가">변동 조건</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
          <div>
            <SubLabel onClear={params.diff_amount != null ? () => onChange({ diff_amount: undefined }) : undefined}>
              변동폭 (금액)
            </SubLabel>
            <div className="mb-2">
              <PresetChips values={DIFF_PRESETS} current={params.diff_amount} format={v => formatEok(v)}
                onPick={v => onChange({ diff_amount: v })} />
            </div>
            <UnitInput label="변동폭 (만원 이상)" placeholder="직접 입력" unit="만원 ↑" step={1000} min={0}
              value={params.diff_amount} onValue={v => onChange({ diff_amount: v })} />
          </div>
          <div>
            <SubLabel onClear={params.diff_rate != null ? () => onChange({ diff_rate: undefined }) : undefined}>
              변동률 (비율)
            </SubLabel>
            <div className="mb-2">
              <PresetChips values={RATE_PRESETS} current={params.diff_rate} format={v => `${v}%`}
                onPick={v => onChange({ diff_rate: v })} />
            </div>
            <UnitInput label="변동률 (% 이상)" placeholder="직접 입력" unit="% ↑" min={0}
              value={params.diff_rate} onValue={v => onChange({ diff_rate: v })} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Segmented
            size="sm"
            value={params.diff_operator}
            onChange={v => onChange({ diff_operator: v })}
            options={[
              { value: 'AND', label: '둘 다 충족' },
              { value: 'OR', label: '하나만 충족' },
            ]}
          />
          <span className="text-xs text-ink-3">
            {bothDiff
              ? (params.diff_operator === 'AND'
                ? '변동폭과 변동률을 모두 넘는 단지만 찾습니다.'
                : '변동폭이나 변동률 가운데 하나만 넘어도 찾습니다.')
              : '변동폭과 변동률을 함께 넣었을 때 적용됩니다.'}
          </span>
        </div>
      </div>

      {/* 상세 조건 (접기) */}
      <div>
        <button
          type="button"
          onClick={toggleAdv}
          aria-expanded={advOpen ?? undefined}
          className="w-full flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-left hover:bg-surface-3 transition-colors cursor-pointer"
        >
          <span className="text-sm font-semibold text-ink">상세 조건</span>
          {advCount > 0 && <Badge tone="brand"><span className="num">{advCount}</span>개 적용</Badge>}
          <span className="ml-auto hidden sm:inline text-xs text-ink-3 truncate">매매가 · 건축년도 · 매수자 · 거래건수 · 제외 옵션</span>
          <svg
            className={cx('ml-auto sm:ml-1 shrink-0 text-ink-3 transition-transform',
              advOpen === null ? 'lg:rotate-180' : advOpen && 'rotate-180')}
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        <div className={cx('space-y-6 pt-5', advOpen === null ? 'hidden lg:block' : advOpen ? 'block' : 'hidden')}>
          {/* 매매가 범위 */}
          <div>
            <Label hint={
              <span className="num">
                {params.price_min != null ? formatEok(params.price_min) : '하한 없음'} ~ {params.price_max != null ? formatEok(params.price_max) : '상한 없음'}
              </span>
            }>매매가 범위</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <SubLabel onClear={params.price_min != null ? () => onChange({ price_min: undefined }) : undefined}>최소 (이상)</SubLabel>
                <div className="mb-2">
                  <PresetChips values={PRICE_PRESETS} current={params.price_min} format={v => formatEok(v)}
                    onPick={v => onChange({ price_min: v })} />
                </div>
                <UnitInput label="최소 매매가 (만원)" placeholder="직접 입력" unit="만원" step={1000} min={0}
                  value={params.price_min} onValue={v => onChange({ price_min: v })} />
              </div>
              <div>
                <SubLabel onClear={params.price_max != null ? () => onChange({ price_max: undefined }) : undefined}>최대 (이하)</SubLabel>
                <div className="mb-2">
                  <PresetChips values={PRICE_PRESETS} current={params.price_max} format={v => formatEok(v)}
                    onPick={v => onChange({ price_max: v })} />
                </div>
                <UnitInput label="최대 매매가 (만원)" placeholder="직접 입력" unit="만원" step={1000} min={0}
                  value={params.price_max} onValue={v => onChange({ price_max: v })} />
              </div>
            </div>
          </div>

          {/* 건축년도 */}
          <div>
            <Label hint={
              <span className="num">
                {params.build_year_from ?? '하한 없음'} ~ {params.build_year_to ?? '상한 없음'}
              </span>
            }>건축년도</Label>
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <span className="text-xs text-ink-3 mr-0.5">최근</span>
              {RECENT_YEAR_PRESETS.map(y => {
                const fromYear = thisYear - y;
                const active = params.build_year_from === fromYear && params.build_year_to == null;
                return (
                  <Chip key={y} size="sm" active={active}
                    onClick={() => onChange(active
                      ? { build_year_from: undefined }
                      : { build_year_from: fromYear, build_year_to: undefined })}>
                    <span className="num">{y}</span>년 이내
                  </Chip>
                );
              })}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <SubLabel onClear={params.build_year_from != null ? () => onChange({ build_year_from: undefined }) : undefined}>시작 (이후)</SubLabel>
                <div className="mb-2">
                  <PresetChips values={BUILD_YEAR_PRESETS} current={params.build_year_from} format={yearLabel}
                    onPick={v => onChange({ build_year_from: v })} />
                </div>
                <UnitInput label="건축년도 시작" placeholder="직접 입력" unit="년" min={1900}
                  value={params.build_year_from} onValue={v => onChange({ build_year_from: v })} />
              </div>
              <div>
                <SubLabel onClear={params.build_year_to != null ? () => onChange({ build_year_to: undefined }) : undefined}>종료 (이전)</SubLabel>
                <div className="mb-2">
                  <PresetChips values={BUILD_YEAR_PRESETS} current={params.build_year_to} format={yearLabel}
                    onPick={v => onChange({ build_year_to: v })} />
                </div>
                <UnitInput label="건축년도 종료" placeholder="직접 입력" unit="년" min={1900}
                  value={params.build_year_to} onValue={v => onChange({ build_year_to: v })} />
              </div>
            </div>
          </div>

          {/* 매수자 · 최소 거래건수 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
            <div>
              <Label>매수자</Label>
              <Segmented<'' | '개인' | '법인'>
                value={params.buyer_gbn ?? ''}
                onChange={v => onChange({ buyer_gbn: v })}
                options={[
                  { value: '', label: '전체' },
                  { value: '개인', label: '개인만' },
                  { value: '법인', label: '법인만' },
                ]}
              />
            </div>
            <div>
              <Label hint="이 건수 이상 거래된 평형만">최소 거래건수</Label>
              <div className="max-w-[9rem]">
                <UnitInput label="최소 거래건수" placeholder="1" unit="건 ↑" min={1}
                  value={params.min_trade_count}
                  onValue={v => onChange({ min_trade_count: v && v >= 1 ? Math.floor(v) : 1 })} />
              </div>
            </div>
          </div>

          {/* 제외 옵션 */}
          <div>
            <Label>제외 옵션</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <CheckCard
                checked={params.exclude_cancelled}
                onChange={v => onChange({ exclude_cancelled: v })}
                title="해제거래 제외"
                desc="계약이 취소된 거래를 뺍니다. 켜 두기를 권합니다."
              />
              <CheckCard
                checked={params.exclude_direct ?? false}
                onChange={v => onChange({ exclude_direct: v })}
                title="직거래 제외"
                desc="중개 없이 이뤄진 거래(가족 간 거래 등)를 뺍니다."
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 적용 중인 조건 요약 (지울 수 있는 칩) ──────────────────────────────────────

interface Cond { key: string; label: ReactNode; text: string; onRemove?: () => void; tone?: 'warn' }

export function ActiveConditions({ params, onChange, regionCount, onClearRegions, className }: {
  params: SearchParams;
  onChange: (p: Partial<SearchParams>) => void;
  regionCount: number;
  onClearRegions: () => void;
  className?: string;
}) {
  const conds: Cond[] = [];

  if (params.apt_nm?.trim()) {
    const t = `단지 “${params.apt_nm.trim()}”`;
    conds.push({ key: 'apt', label: t, text: t, onRemove: () => onChange({ apt_nm: undefined }) });
  }
  if (regionCount > 0) {
    const t = `지역 ${regionCount}곳`;
    conds.push({ key: 'region', label: <>지역 <span className="num">{regionCount}</span>곳</>, text: t, onRemove: onClearRegions });
  }

  const period = matchPeriodPreset(params);
  const periodText = period ? (period.months === 0 ? '전체 기간' : `최근 ${period.label}`) : `${params.date_from} ~ ${params.date_to}`;
  conds.push({ key: 'period', label: <span className="num">{periodText}</span>, text: periodText });

  if (params.diff_amount != null) {
    const t = `변동폭 ${formatEok(params.diff_amount)} 이상`;
    conds.push({ key: 'diffA', label: <span className="num">{t}</span>, text: t, onRemove: () => onChange({ diff_amount: undefined }) });
  }
  if (params.diff_amount != null && params.diff_rate != null) {
    const t = params.diff_operator === 'AND' ? '그리고' : '또는';
    conds.push({ key: 'op', label: t, text: t });
  }
  if (params.diff_rate != null) {
    const t = `변동률 ${params.diff_rate}% 이상`;
    conds.push({ key: 'diffR', label: <span className="num">{t}</span>, text: t, onRemove: () => onChange({ diff_rate: undefined }) });
  }
  if (params.price_min != null || params.price_max != null) {
    const t = `매매가 ${params.price_min != null ? formatEok(params.price_min) : ''} ~ ${params.price_max != null ? formatEok(params.price_max) : ''}`.trim();
    conds.push({ key: 'price', label: <span className="num">{t}</span>, text: t, onRemove: () => onChange({ price_min: undefined, price_max: undefined }) });
  }
  if (params.build_year_from != null || params.build_year_to != null) {
    const t = params.build_year_from != null && params.build_year_to != null
      ? `${params.build_year_from}~${params.build_year_to}년 건축`
      : params.build_year_from != null ? `${params.build_year_from}년 이후 건축` : `${params.build_year_to}년 이전 건축`;
    conds.push({ key: 'year', label: <span className="num">{t}</span>, text: t, onRemove: () => onChange({ build_year_from: undefined, build_year_to: undefined }) });
  }
  if (params.buyer_gbn) {
    const t = `매수자 ${params.buyer_gbn}`;
    conds.push({ key: 'buyer', label: t, text: t, onRemove: () => onChange({ buyer_gbn: '' }) });
  }
  if (params.min_trade_count > 1) {
    const t = `거래 ${params.min_trade_count}건 이상`;
    conds.push({ key: 'cnt', label: <span className="num">{t}</span>, text: t, onRemove: () => onChange({ min_trade_count: 1 }) });
  }
  if (!params.exclude_cancelled) {
    conds.push({ key: 'cancel', label: '해제거래 포함', text: '해제거래 포함', tone: 'warn', onRemove: () => onChange({ exclude_cancelled: true }) });
  }
  if (!(params.exclude_direct ?? false)) {
    conds.push({ key: 'direct', label: '직거래 포함', text: '직거래 포함', tone: 'warn', onRemove: () => onChange({ exclude_direct: true }) });
  }

  return (
    <ul className={cx('flex items-center gap-1.5', className)} aria-label="적용 중인 조건">
      {conds.map(c => (
        <li
          key={c.key}
          className={cx(
            'inline-flex items-center gap-1 rounded-full text-xs font-medium whitespace-nowrap shrink-0 py-1',
            c.onRemove ? 'pl-2.5 pr-1' : 'px-2.5',
            !c.onRemove ? 'bg-surface-3 text-ink-2' : c.tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-brand-soft text-brand',
          )}
        >
          {c.label}
          {c.onRemove && (
            <button
              type="button"
              onClick={c.onRemove}
              aria-label={`${c.text} 조건 지우기`}
              title="이 조건 지우기"
              className="h-4 w-4 inline-flex items-center justify-center rounded-full opacity-70 hover:opacity-100 hover:bg-surface cursor-pointer"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
