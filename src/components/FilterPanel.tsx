'use client';

import type { SearchParams } from '@/types';

interface Props {
  params: SearchParams;
  onChange: (p: Partial<SearchParams>) => void;
}

export default function FilterPanel({ params, onChange }: Props) {
  return (
    <div className="space-y-4">
      {/* 조회 기간 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">조회 기간</label>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={params.date_from}
            onChange={e => onChange({ date_from: e.target.value })}
            className="border rounded px-2 py-1 text-sm"
          />
          <span className="text-gray-500">~</span>
          <input
            type="date"
            value={params.date_to}
            onChange={e => onChange({ date_to: e.target.value })}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>
      </div>

      {/* 매매가 범위 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">매매가 (만원)</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            placeholder="최소"
            value={params.price_min ?? ''}
            onChange={e => onChange({ price_min: e.target.value ? Number(e.target.value) : undefined })}
            className="border rounded px-2 py-1 text-sm w-32"
          />
          <span className="text-gray-500">~</span>
          <input
            type="number"
            placeholder="최대"
            value={params.price_max ?? ''}
            onChange={e => onChange({ price_max: e.target.value ? Number(e.target.value) : undefined })}
            className="border rounded px-2 py-1 text-sm w-32"
          />
        </div>
      </div>

      {/* 변동 조건 */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <label className="text-sm font-medium text-gray-700">변동 조건</label>
          <div className="flex rounded border overflow-hidden text-sm">
            <button
              onClick={() => onChange({ diff_operator: 'AND' })}
              className={`px-2 py-0.5 ${params.diff_operator === 'AND' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600'}`}
            >AND</button>
            <button
              onClick={() => onChange({ diff_operator: 'OR' })}
              className={`px-2 py-0.5 ${params.diff_operator === 'OR' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600'}`}
            >OR</button>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex items-center gap-1">
            <input
              type="number"
              placeholder="변동폭"
              value={params.diff_amount ?? ''}
              onChange={e => onChange({ diff_amount: e.target.value ? Number(e.target.value) : undefined })}
              className="border rounded px-2 py-1 text-sm w-28"
            />
            <span className="text-xs text-gray-500">만원 이상</span>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="number"
              placeholder="변동률"
              value={params.diff_rate ?? ''}
              onChange={e => onChange({ diff_rate: e.target.value ? Number(e.target.value) : undefined })}
              className="border rounded px-2 py-1 text-sm w-20"
            />
            <span className="text-xs text-gray-500">% 이상</span>
          </div>
        </div>
      </div>

      {/* 건축년도 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">건축년도</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            placeholder="시작"
            value={params.build_year_from ?? ''}
            onChange={e => onChange({ build_year_from: e.target.value ? Number(e.target.value) : undefined })}
            className="border rounded px-2 py-1 text-sm w-24"
          />
          <span className="text-gray-500">~</span>
          <input
            type="number"
            placeholder="종료"
            value={params.build_year_to ?? ''}
            onChange={e => onChange({ build_year_to: e.target.value ? Number(e.target.value) : undefined })}
            className="border rounded px-2 py-1 text-sm w-24"
          />
        </div>
      </div>

      {/* 거래유형 / 매수자유형 */}
      <div className="flex gap-4 flex-wrap">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">거래유형</label>
          <select
            value={params.dealing_gbn ?? ''}
            onChange={e => onChange({ dealing_gbn: e.target.value as SearchParams['dealing_gbn'] })}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="">전체</option>
            <option value="중개">중개</option>
            <option value="직거래">직거래</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">매수자</label>
          <select
            value={params.buyer_gbn ?? ''}
            onChange={e => onChange({ buyer_gbn: e.target.value as SearchParams['buyer_gbn'] })}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="">전체</option>
            <option value="개인">개인만</option>
            <option value="법인">법인만</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">최소 거래건수</label>
          <input
            type="number"
            min={2}
            value={params.min_trade_count}
            onChange={e => onChange({ min_trade_count: Number(e.target.value) || 2 })}
            className="border rounded px-2 py-1 text-sm w-20"
          />
        </div>
      </div>

      {/* 해제거래 제외 */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={params.exclude_cancelled}
          onChange={e => onChange({ exclude_cancelled: e.target.checked })}
        />
        <span className="text-sm text-gray-700">해제거래 제외 (권장)</span>
      </label>
    </div>
  );
}
