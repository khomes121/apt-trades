'use client';

import { useMemo, useState } from 'react';
import { Badge, Chip, cx } from '@/components/ui';
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

interface SummaryChip { key: string; label: string; codes: string[] }

export default function RegionSelector({ regions, selectedCodes, onChange }: Props) {
  const [openSido, setOpenSido] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');

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

  // 프리셋이 가리키는 코드 묶음 — 지금 선택과 똑같으면 그 칩을 켜 보인다
  const presetCodes = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const [key, p] of Object.entries(PRESETS)) {
      const sido = new Set(p.sido_cds);
      out[key] = (sido.size === 0 ? regions : regions.filter(r => sido.has(r.sido_cd))).map(r => r.sgg_cd);
    }
    return out;
  }, [regions]);

  const activePreset = useMemo(() => {
    if (selectedSet.size === 0) return null;
    for (const [key, codes] of Object.entries(presetCodes)) {
      if (codes.length > 0 && codes.length === selectedSet.size && codes.every(c => selectedSet.has(c))) return key;
    }
    return null;
  }, [presetCodes, selectedSet]);

  const kw = keyword.trim().replace(/\s+/g, ' ').toLowerCase();
  const matches = useMemo(() => {
    if (!kw) return [];
    const tokens = kw.split(' ');
    return regions.filter(r => {
      const hay = `${r.sido_nm} ${r.sgg_nm}`.toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
  }, [regions, kw]);

  // 선택 요약 — 시·도 전체면 한 칩, 몇 곳뿐이면 하나씩, 많으면 'N곳'
  const summary = useMemo<SummaryChip[]>(() => {
    const chips: SummaryChip[] = [];
    for (const g of sidoGroups) {
      const picked = g.regions.filter(r => selectedSet.has(r.sgg_cd));
      if (picked.length === 0) continue;
      if (picked.length === g.regions.length && g.regions.length > 1) {
        chips.push({ key: g.sido_cd, label: `${g.sido_nm} 전체`, codes: picked.map(r => r.sgg_cd) });
      } else if (picked.length <= 3) {
        for (const r of picked) chips.push({ key: r.sgg_cd, label: `${shortSido(g.sido_nm)} ${r.sgg_nm}`, codes: [r.sgg_cd] });
      } else {
        chips.push({ key: g.sido_cd, label: `${g.sido_nm} ${picked.length}곳`, codes: picked.map(r => r.sgg_cd) });
      }
    }
    return chips;
  }, [sidoGroups, selectedSet]);

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

  function removeCodes(codes: string[]) {
    const drop = new Set(codes);
    onChange(selectedCodes.filter(c => !drop.has(c)));
  }

  function addCodes(codes: string[]) {
    const next = new Set(selectedSet);
    codes.forEach(c => next.add(c));
    onChange(Array.from(next));
  }

  const allMatchesSelected = matches.length > 0 && matches.every(r => selectedSet.has(r.sgg_cd));

  return (
    <div className="space-y-4">
      {/* 프리셋 */}
      <div className="flex gap-1.5 flex-wrap">
        {Object.entries(PRESETS).map(([key, p]) => (
          <Chip key={key} active={activePreset === key} onClick={() => onChange(presetCodes[key] ?? [])}>
            {p.label}
          </Chip>
        ))}
        <Chip onClick={() => onChange([])} disabled={selectedCodes.length === 0}
          className="disabled:opacity-40 disabled:cursor-not-allowed">
          초기화
        </Chip>
      </div>

      {/* 선택 현황 */}
      <div className="rounded-xl bg-surface-2 border border-line px-3.5 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-ink-2">
            {selectedCodes.length === 0 ? (
              '아직 고른 지역이 없습니다'
            ) : (
              <>
                <b className="num text-base font-bold text-brand">{selectedCodes.length}</b>
                <span className="num text-ink-3"> / {regions.length}</span> 개 구·군 선택
              </>
            )}
          </span>
          {activePreset && <Badge tone="brand">{PRESETS[activePreset].label}</Badge>}
        </div>
        {summary.length > 0 && (
          <ul className="mt-2.5 flex flex-wrap gap-1 max-h-[4.75rem] overflow-y-auto">
            {summary.map(c => (
              <li key={c.key}
                className="inline-flex items-center gap-0.5 rounded-full bg-brand-soft text-brand text-xs font-medium pl-2 pr-1 py-0.5 whitespace-nowrap">
                {c.label}
                <button type="button" onClick={() => removeCodes(c.codes)} aria-label={`${c.label} 선택 해제`}
                  className="h-4 w-4 inline-flex items-center justify-center rounded-full opacity-70 hover:opacity-100 hover:bg-surface cursor-pointer">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 이름으로 찾기 */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" width="15" height="15" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          placeholder="구·군 이름으로 찾기 — 예: 해운대, 분당"
          aria-label="구·군 이름으로 찾기"
          className="field !pl-9"
        />
      </div>

      {/* 목록 */}
      <div className="rounded-xl border border-line overflow-hidden">
        <div className="max-h-64 lg:max-h-[26rem] overflow-y-auto overscroll-contain">
          {kw ? (
            matches.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-ink-3">
                “{keyword.trim()}”에 해당하는 구·군이 없습니다.
              </div>
            ) : (
              <>
                <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 bg-surface-2 border-b border-line px-3 py-2">
                  <span className="text-xs text-ink-3">찾은 곳 <b className="num text-ink-2">{matches.length}</b>곳</span>
                  <button type="button"
                    onClick={() => (allMatchesSelected ? removeCodes(matches.map(r => r.sgg_cd)) : addCodes(matches.map(r => r.sgg_cd)))}
                    className="text-xs font-semibold text-brand hover:underline cursor-pointer">
                    {allMatchesSelected ? '모두 해제' : '모두 선택'}
                  </button>
                </div>
                <ul>
                  {matches.map(r => {
                    const on = selectedSet.has(r.sgg_cd);
                    return (
                      <li key={r.sgg_cd} className="border-b border-line last:border-b-0">
                        <label className={cx('flex items-center gap-2.5 px-3 py-2.5 text-sm cursor-pointer transition-colors',
                          on ? 'bg-brand-soft' : 'hover:bg-surface-2')}>
                          <input type="checkbox" checked={on} onChange={() => toggleSgg(r.sgg_cd)} className="h-4 w-4 shrink-0" />
                          <span className={cx('font-medium', on ? 'text-brand' : 'text-ink')}>{r.sgg_nm}</span>
                          <span className="ml-auto text-xs text-ink-3 truncate">{r.sido_nm}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </>
            )
          ) : (
            <ul>
              {sidoGroups.map(group => {
                const codes = group.regions.map(r => r.sgg_cd);
                const selectedCount = codes.filter(c => selectedSet.has(c)).length;
                const allSelected = selectedCount === codes.length;
                const isOpen = openSido === group.sido_cd;

                return (
                  <li key={group.sido_cd} className="border-b border-line last:border-b-0">
                    <div className={cx('flex items-center gap-2.5 pl-3 pr-2 transition-colors', isOpen ? 'bg-surface-2' : 'hover:bg-surface-2')}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={el => { if (el) el.indeterminate = selectedCount > 0 && !allSelected; }}
                        onChange={() => toggleSido(group)}
                        aria-label={`${group.sido_nm} 전체 선택`}
                        className="h-4 w-4 shrink-0 cursor-pointer"
                      />
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setOpenSido(isOpen ? null : group.sido_cd)}
                        className="flex-1 min-w-0 flex items-center gap-2 py-2.5 text-left cursor-pointer"
                      >
                        <span className="text-sm font-medium text-ink truncate">{group.sido_nm}</span>
                        <Badge tone={selectedCount > 0 ? 'brand' : 'neutral'} className="ml-auto">
                          <span className="num">{selectedCount}/{codes.length}</span>
                        </Badge>
                        <svg className={cx('shrink-0 text-ink-3 transition-transform', isOpen && 'rotate-180')}
                          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
                          strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>
                    </div>

                    {isOpen && (
                      <div className="grid grid-cols-2 gap-1 px-2.5 pb-3 pt-1 bg-surface-2">
                        {group.regions.map(r => {
                          const on = selectedSet.has(r.sgg_cd);
                          return (
                            <label key={r.sgg_cd}
                              className={cx('flex items-center gap-2 min-w-0 rounded-lg border px-2 py-1.5 text-[0.8125rem] cursor-pointer transition-colors',
                                on ? 'border-brand bg-brand-soft text-brand font-medium' : 'border-transparent text-ink-2 hover:bg-surface-3')}>
                              <input type="checkbox" checked={on} onChange={() => toggleSgg(r.sgg_cd)} className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{r.sgg_nm}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** '부산광역시' → '부산', '경상남도' → '경남' (요약 칩이 길어지지 않게) */
function shortSido(name: string): string {
  const map: Record<string, string> = {
    충청북도: '충북', 충청남도: '충남', 전라북도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남',
    전북특별자치도: '전북', 강원특별자치도: '강원', 제주특별자치도: '제주', 세종특별자치시: '세종',
  };
  if (map[name]) return map[name];
  return name.replace(/(특별시|광역시|특별자치시|특별자치도|도)$/, '');
}
