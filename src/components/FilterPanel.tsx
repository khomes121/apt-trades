'use client';

import type { SearchParams } from '@/types';

interface Props {
  params: SearchParams;
  onChange: (p: Partial<SearchParams>) => void;
}

const PERIOD_PRESETS = [
  { label: '3개월', months: 3 },
  { label: '6개월', months: 6 },
  { label: '1년', months: 12 },
  { label: '2년', months: 24 },
  { label: '3년', months: 36 },
  { label: '전체', months: 0 },
];

const DIFF_PRESETS = [1000, 2000, 3000, 4000, 5000, 10000];

const PRICE_PRESETS = [3000, 5000, 7000, 10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 100000, 150000, 200000];

const BUILD_YEAR_PRESETS = [1970, 1975, 1980, 1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025];
const RECENT_YEAR_PRESETS = [5, 10, 15, 20, 30, 40];

function yearLabel(y: number): string {
  return `${String(y).slice(2)}년`;
}

function priceLabel(v: number): string {
  return v >= 10000 ? `${v / 10000}억` : `${v / 1000}천`;
}

function getDateRange(months: number) {
  const today = new Date();
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (months === 0) {
    return { date_from: '2006-01-01', date_to: fmt(today) };
  }
  const from = new Date(today);
  from.setMonth(from.getMonth() - months);
  return { date_from: fmt(from), date_to: fmt(today) };
}

export default function FilterPanel({ params, onChange }: Props) {
  return (
    <div className="space-y-5">

      {/* 단지명 검색 */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">단지명</label>
        <input
          type="text"
          placeholder="예: 신평 현대 (동명+단지명 띄어쓰기 가능)"
          value={params.apt_nm ?? ''}
          onChange={e => onChange({ apt_nm: e.target.value || undefined })}
          className="border rounded-lg px-3 py-1.5 text-sm w-full"
        />
      </div>

      {/* 조회 기간 */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">조회 기간</label>
        <div className="flex flex-wrap gap-2 mb-2">
          {PERIOD_PRESETS.map(p => (
            <button
              key={p.months}
              onClick={() => onChange(getDateRange(p.months))}
              className="px-3 py-1 text-sm rounded-full border border-blue-400 text-blue-600 hover:bg-blue-50 transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={params.date_from}
            onChange={e => onChange({ date_from: e.target.value })}
            className="border rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[130px]"
          />
          <span className="text-gray-400">~</span>
          <input
            type="date"
            value={params.date_to}
            onChange={e => onChange({ date_to: e.target.value })}
            className="border rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[130px]"
          />
        </div>
      </div>

      {/* 매매가 범위 */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          매매가 범위
          <span className="ml-2 text-xs font-normal text-gray-400">
            {params.price_min ? priceLabel(params.price_min) : '하한없음'} ~{' '}
            {params.price_max ? priceLabel(params.price_max) : '상한없음'}
          </span>
        </label>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {/* 최소가 */}
          <div>
            <div className="text-xs text-gray-500 mb-1">최소 이상</div>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {PRICE_PRESETS.map(v => (
                <button
                  key={v}
                  onClick={() => onChange({ price_min: v })}
                  className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${
                    params.price_min === v
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >{priceLabel(v)}</button>
              ))}
              <button
                onClick={() => onChange({ price_min: undefined })}
                className="px-1.5 py-0.5 text-xs rounded border border-gray-200 text-gray-400 hover:bg-gray-50"
              >없음</button>
            </div>
            <input
              type="number"
              placeholder="직접입력 (만원)"
              value={params.price_min ?? ''}
              step={1000}
              onChange={e => onChange({ price_min: e.target.value ? Number(e.target.value) : undefined })}
              className="border rounded-lg px-3 py-1.5 text-sm w-full min-w-0"
            />
          </div>
          {/* 최대가 */}
          <div>
            <div className="text-xs text-gray-500 mb-1">최대 이하</div>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {PRICE_PRESETS.map(v => (
                <button
                  key={v}
                  onClick={() => onChange({ price_max: v })}
                  className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${
                    params.price_max === v
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >{priceLabel(v)}</button>
              ))}
              <button
                onClick={() => onChange({ price_max: undefined })}
                className="px-1.5 py-0.5 text-xs rounded border border-gray-200 text-gray-400 hover:bg-gray-50"
              >없음</button>
            </div>
            <input
              type="number"
              placeholder="직접입력 (만원)"
              value={params.price_max ?? ''}
              step={1000}
              onChange={e => onChange({ price_max: e.target.value ? Number(e.target.value) : undefined })}
              className="border rounded-lg px-3 py-1.5 text-sm w-full min-w-0"
            />
          </div>
        </div>
      </div>

      {/* 변동 조건 */}
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <label className="text-sm font-semibold text-gray-700">변동 조건</label>
          <div className="flex rounded-lg border overflow-hidden text-sm shrink-0">
            <button
              onClick={() => onChange({ diff_operator: 'AND' })}
              className={`px-3 py-1 ${params.diff_operator === 'AND' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >AND</button>
            <button
              onClick={() => onChange({ diff_operator: 'OR' })}
              className={`px-3 py-1 ${params.diff_operator === 'OR' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >OR</button>
          </div>
          <span className="text-xs text-gray-400 leading-tight">
            AND: 폭+률 모두 충족 / OR: 하나만 충족
          </span>
        </div>

        {/* 변동폭 프리셋 */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {DIFF_PRESETS.map(v => (
            <button
              key={v}
              onClick={() => onChange({ diff_amount: v })}
              className={`px-2.5 py-1 text-sm rounded-full border transition-colors ${
                params.diff_amount === v
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {v >= 10000 ? `${v / 10000}억` : `${v / 1000}천만`}
            </button>
          ))}
          <button
            onClick={() => onChange({ diff_amount: undefined })}
            className="px-2.5 py-1 text-sm rounded-full border border-gray-200 text-gray-400 hover:bg-gray-50 transition-colors"
          >
            초기화
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-1 min-w-0">
            <input
              type="number"
              placeholder="변동폭"
              value={params.diff_amount ?? ''}
              step={1000}
              onChange={e => onChange({ diff_amount: e.target.value ? Number(e.target.value) : undefined })}
              className="border rounded-lg px-3 py-1.5 text-sm w-full min-w-0"
            />
            <span className="text-xs text-gray-500 whitespace-nowrap shrink-0">만원↑</span>
          </div>
          <div className="flex items-center gap-1 min-w-0">
            <input
              type="number"
              placeholder="변동률"
              value={params.diff_rate ?? ''}
              onChange={e => onChange({ diff_rate: e.target.value ? Number(e.target.value) : undefined })}
              className="border rounded-lg px-3 py-1.5 text-sm w-full min-w-0"
            />
            <span className="text-xs text-gray-500 whitespace-nowrap shrink-0">%↑</span>
          </div>
        </div>
      </div>

      {/* 건축년도 */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          건축년도
          <span className="ml-2 text-xs font-normal text-gray-400">
            {params.build_year_from ?? '하한없음'} ~ {params.build_year_to ?? '상한없음'}
          </span>
        </label>
        {/* 최근 N년 이내 빠른 프리셋 */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          <span className="text-xs text-gray-500 self-center mr-1">최근</span>
          {RECENT_YEAR_PRESETS.map(y => {
            const fromYear = new Date().getFullYear() - y;
            const active = params.build_year_from === fromYear && params.build_year_to == null;
            return (
              <button
                key={y}
                onClick={() => onChange({ build_year_from: fromYear, build_year_to: undefined })}
                className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                  active
                    ? 'bg-blue-500 text-white border-blue-500'
                    : 'border-blue-300 text-blue-600 hover:bg-blue-50'
                }`}
              >{`${y}년 이내`}</button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <div>
            <div className="text-xs text-gray-500 mb-1">시작 (이후)</div>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {BUILD_YEAR_PRESETS.map(y => (
                <button
                  key={y}
                  onClick={() => onChange({ build_year_from: y })}
                  className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${
                    params.build_year_from === y
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >{yearLabel(y)}</button>
              ))}
              <button
                onClick={() => onChange({ build_year_from: undefined })}
                className="px-1.5 py-0.5 text-xs rounded border border-gray-200 text-gray-400 hover:bg-gray-50"
              >없음</button>
            </div>
            <input
              type="number"
              placeholder="직접입력 (연도)"
              value={params.build_year_from ?? ''}
              onChange={e => onChange({ build_year_from: e.target.value ? Number(e.target.value) : undefined })}
              className="border rounded-lg px-3 py-1.5 text-sm w-full min-w-0"
            />
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">종료 (이전)</div>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {BUILD_YEAR_PRESETS.map(y => (
                <button
                  key={y}
                  onClick={() => onChange({ build_year_to: y })}
                  className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${
                    params.build_year_to === y
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >{yearLabel(y)}</button>
              ))}
              <button
                onClick={() => onChange({ build_year_to: undefined })}
                className="px-1.5 py-0.5 text-xs rounded border border-gray-200 text-gray-400 hover:bg-gray-50"
              >없음</button>
            </div>
            <input
              type="number"
              placeholder="직접입력 (연도)"
              value={params.build_year_to ?? ''}
              onChange={e => onChange({ build_year_to: e.target.value ? Number(e.target.value) : undefined })}
              className="border rounded-lg px-3 py-1.5 text-sm w-full min-w-0"
            />
          </div>
        </div>
      </div>

      {/* 기타 옵션 */}
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">매수자</label>
          <select
            value={params.buyer_gbn ?? ''}
            onChange={e => onChange({ buyer_gbn: e.target.value as SearchParams['buyer_gbn'] })}
            className="border rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="">전체</option>
            <option value="개인">개인만</option>
            <option value="법인">법인만</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">최소 거래건수</label>
          <input
            type="number"
            min={1}
            value={params.min_trade_count}
            onChange={e => onChange({ min_trade_count: Number(e.target.value) || 1 })}
            className="border rounded-lg px-3 py-1.5 text-sm w-20"
          />
        </div>
      </div>

      {/* 체크박스 옵션 */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={params.exclude_cancelled}
            onChange={e => onChange({ exclude_cancelled: e.target.checked })}
            className="w-4 h-4 accent-blue-500"
          />
          <span className="text-sm text-gray-700">해제거래 제외 (권장)</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={params.exclude_direct ?? false}
            onChange={e => onChange({ exclude_direct: e.target.checked })}
            className="w-4 h-4 accent-blue-500"
          />
          <span className="text-sm text-gray-700">직거래 제외</span>
        </label>
      </div>
    </div>
  );
}
