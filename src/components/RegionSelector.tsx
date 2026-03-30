'use client';

import { useMemo, useState } from 'react';
import type { Region, SidoGroup } from '@/types';

const PRESETS: Record<string, { label: string; sido_cds: string[] }> = {
  busan:    { label: '부산',     sido_cds: ['26'] },
  sudogwon: { label: '수도권',   sido_cds: ['11', '41', '28'] },
  major5:   { label: '5대광역시', sido_cds: ['26', '27', '29', '30', '31'] },
  all:      { label: '전국',     sido_cds: [] }, // 빈 배열 = 전체
};

interface Props {
  regions: Region[];
  selectedCodes: string[];
  onChange: (codes: string[]) => void;
}

export default function RegionSelector({ regions, selectedCodes, onChange }: Props) {
  const [openSido, setOpenSido] = useState<string | null>(null);

  const sidoGroups = useMemo<SidoGroup[]>(() => {
    const map = new Map<string, SidoGroup>();
    for (const r of regions) {
      if (!map.has(r.sido_cd)) {
        map.set(r.sido_cd, { sido_cd: r.sido_cd, sido_nm: r.sido_nm, regions: [] });
      }
      map.get(r.sido_cd)!.regions.push(r);
    }
    return Array.from(map.values()).sort((a, b) => a.sido_cd.localeCompare(b.sido_cd));
  }, [regions]);

  const selectedSet = useMemo(() => new Set(selectedCodes), [selectedCodes]);

  function toggleSgg(code: string) {
    const next = new Set(selectedSet);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(Array.from(next));
  }

  function toggleSido(group: SidoGroup) {
    const codes = group.regions.map(r => r.sgg_cd);
    const allSelected = codes.every(c => selectedSet.has(c));
    const next = new Set(selectedSet);
    if (allSelected) codes.forEach(c => next.delete(c));
    else codes.forEach(c => next.add(c));
    onChange(Array.from(next));
  }

  function applyPreset(key: string) {
    const preset = PRESETS[key];
    if (preset.sido_cds.length === 0) {
      onChange(regions.map(r => r.sgg_cd));
    } else {
      const sidoCodes = new Set(preset.sido_cds);
      onChange(regions.filter(r => sidoCodes.has(r.sido_cd)).map(r => r.sgg_cd));
    }
  }

  return (
    <div className="space-y-3">
      {/* 프리셋 버튼 */}
      <div className="flex gap-2 flex-wrap">
        {Object.entries(PRESETS).map(([key, p]) => (
          <button
            key={key}
            onClick={() => applyPreset(key)}
            className="px-3 py-1 text-sm rounded border border-blue-400 text-blue-600 hover:bg-blue-50 transition-colors"
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => onChange([])}
          className="px-3 py-1 text-sm rounded border border-gray-300 text-gray-500 hover:bg-gray-50 transition-colors"
        >
          초기화
        </button>
      </div>

      {/* 선택 현황 */}
      <div className="text-sm text-gray-600">
        {selectedCodes.length === 0
          ? '지역을 선택하세요'
          : `${selectedCodes.length}개 구/군 선택됨`}
      </div>

      {/* 시/도 목록 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-80 overflow-y-auto border rounded p-2 bg-white">
        {sidoGroups.map(group => {
          const codes = group.regions.map(r => r.sgg_cd);
          const selectedCount = codes.filter(c => selectedSet.has(c)).length;
          const allSelected = selectedCount === codes.length;
          const isOpen = openSido === group.sido_cd;

          return (
            <div key={group.sido_cd} className="col-span-full">
              {/* 시/도 헤더 */}
              <div className="flex items-center gap-2 py-1 px-2 rounded hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = selectedCount > 0 && !allSelected; }}
                  onChange={() => toggleSido(group)}
                  className="cursor-pointer"
                />
                <button
                  className="flex-1 text-left font-medium text-sm text-gray-700"
                  onClick={() => setOpenSido(isOpen ? null : group.sido_cd)}
                >
                  {group.sido_nm}
                  <span className="ml-1 text-xs text-gray-400">
                    ({selectedCount}/{codes.length})
                  </span>
                  <span className="ml-1 text-xs text-gray-400">{isOpen ? '▲' : '▼'}</span>
                </button>
              </div>

              {/* 구/군 목록 (펼침) */}
              {isOpen && (
                <div className="ml-6 grid grid-cols-2 sm:grid-cols-3 gap-1 pb-2">
                  {group.regions.map(r => (
                    <label key={r.sgg_cd} className="flex items-center gap-1 text-sm cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(r.sgg_cd)}
                        onChange={() => toggleSgg(r.sgg_cd)}
                      />
                      {r.sgg_nm}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
