'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';

interface SummaryRow {
  sgg_cd: string;
  sgg_nm: string;
  trade_count: number;
  avg_eok: number;
  min_eok: number;
  max_eok: number;
}

interface TradeRow {
  apt_nm: string;
  apt_dong: string | null;
  umd_nm: string;
  sgg_cd: string;
  sgg_nm: string;
  exclu_use_ar: number;
  area_group: number;
  floor: number;
  deal_amount: number;
  dealing_gbn: string | null;
  build_year: number | null;
}

function toEok(amount: number) {
  return (amount / 10000).toFixed(1);
}

export default function DailyPage() {
  const [date, setDate] = useState<string>('');
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedSgg, setSelectedSgg] = useState<string | null>(null);
  const [showLimit, setShowLimit] = useState(50);

  // 최근 거래일 로드
  useEffect(() => {
    fetch('/api/daily-trades')
      .then(r => r.json())
      .then((d: { latestDate?: string }) => {
        if (d.latestDate) setDate(d.latestDate);
      });
  }, []);

  // 날짜 변경 시 조회
  useEffect(() => {
    if (!date) return;
    setLoading(true);
    setSelectedSgg(null);
    setShowLimit(50);
    fetch(`/api/daily-trades?date=${date}`)
      .then(r => r.json())
      .then((d: { summary: SummaryRow[]; trades: TradeRow[]; total: number }) => {
        setSummary(d.summary ?? []);
        setTrades(d.trades ?? []);
        setTotal(d.total ?? 0);
      })
      .finally(() => setLoading(false));
  }, [date]);

  const filteredTrades = useMemo(() => {
    if (!selectedSgg) return trades;
    return trades.filter(t => t.sgg_cd === selectedSgg);
  }, [trades, selectedSgg]);

  const showing = filteredTrades.slice(0, showLimit);
  const remaining = filteredTrades.length - showLimit;

  // 날짜 ±1일 이동
  function moveDate(delta: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + delta);
    setDate(d.toISOString().slice(0, 10));
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 네비게이션 */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 flex items-center gap-1 h-12">
          <Link href="/" className="px-3 py-1.5 rounded text-sm text-gray-600 hover:bg-gray-100">변동 분석</Link>
          <Link href="/trend" className="px-3 py-1.5 rounded text-sm text-gray-600 hover:bg-gray-100">추이 분석</Link>
          <span className="px-3 py-1.5 rounded text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200">날짜별 실거래</span>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* 날짜 선택 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => moveDate(-1)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm"
            >◀</button>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={() => moveDate(1)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm"
            >▶</button>
            {loading && <span className="text-sm text-gray-400">조회 중...</span>}
            {!loading && total > 0 && (
              <span className="text-sm text-gray-500">총 <strong>{total.toLocaleString()}</strong>건</span>
            )}
            {!loading && total === 0 && date && (
              <span className="text-sm text-gray-400">거래 없음</span>
            )}
          </div>
        </div>

        {total > 0 && (
          <>
            {/* 지역별 요약 */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-800">📍 지역별 요약</h2>
                {selectedSgg && (
                  <button
                    onClick={() => setSelectedSgg(null)}
                    className="text-xs text-blue-600 hover:underline"
                  >전체 보기</button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs">
                      <th className="px-4 py-2 text-left">지역</th>
                      <th className="px-4 py-2 text-right">거래건수</th>
                      <th className="px-4 py-2 text-right">평균가</th>
                      <th className="px-4 py-2 text-right">최저가</th>
                      <th className="px-4 py-2 text-right">최고가</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map(row => (
                      <tr
                        key={row.sgg_cd}
                        onClick={() => setSelectedSgg(selectedSgg === row.sgg_cd ? null : row.sgg_cd)}
                        className={`border-t border-gray-50 cursor-pointer hover:bg-blue-50 transition-colors ${
                          selectedSgg === row.sgg_cd ? 'bg-blue-50 font-medium' : ''
                        }`}
                      >
                        <td className="px-4 py-2.5 text-gray-800">
                          {selectedSgg === row.sgg_cd && '▶ '}
                          {row.sgg_nm ?? row.sgg_cd}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-700">{row.trade_count.toLocaleString()}건</td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-900">{row.avg_eok}억</td>
                        <td className="px-4 py-2.5 text-right text-blue-600">{row.min_eok}억</td>
                        <td className="px-4 py-2.5 text-right text-red-500">{row.max_eok}억</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 거래 목록 */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="font-semibold text-gray-800">
                  📋 거래 목록
                  {selectedSgg && summary.find(s => s.sgg_cd === selectedSgg) && (
                    <span className="ml-2 text-sm font-normal text-blue-600">
                      — {summary.find(s => s.sgg_cd === selectedSgg)?.sgg_nm}
                    </span>
                  )}
                  <span className="ml-2 text-sm font-normal text-gray-400">
                    {filteredTrades.length.toLocaleString()}건
                  </span>
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs">
                      <th className="px-4 py-2 text-left">단지명</th>
                      <th className="px-4 py-2 text-left">지역</th>
                      <th className="px-4 py-2 text-right">면적</th>
                      <th className="px-4 py-2 text-right">층</th>
                      <th className="px-4 py-2 text-right">거래금액</th>
                      <th className="px-4 py-2 text-center">유형</th>
                    </tr>
                  </thead>
                  <tbody>
                    {showing.map((t, i) => (
                      <tr key={i} className="border-t border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-gray-900">{t.apt_nm}</div>
                          {t.apt_dong && <div className="text-xs text-gray-400">{t.apt_dong}</div>}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">
                          {t.sgg_nm ?? t.sgg_cd}<br />{t.umd_nm}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{t.exclu_use_ar}㎡</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{t.floor}층</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-gray-900">
                          {toEok(t.deal_amount)}억
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            t.dealing_gbn === '직거래'
                              ? 'bg-orange-50 text-orange-600'
                              : 'bg-gray-100 text-gray-500'
                          }`}>
                            {t.dealing_gbn ?? '중개'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {remaining > 0 && (
                <div className="px-4 py-3 border-t border-gray-100 text-center">
                  <button
                    onClick={() => setShowLimit(v => v + 50)}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    {remaining.toLocaleString()}건 더 보기 (50건씩)
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
