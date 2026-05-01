'use client';

import { useEffect, useState } from 'react';
import TradeDetailModal from '@/components/TradeDetailModal';

interface WatchItem {
  id: number;
  apt_nm: string;
  sgg_cd: string;
  sgg_nm: string;
  umd_nm: string;
  complex_no: string | null;
  criteria: string | null;
  added_at: string;
}

export default function WatchlistPage() {
  const [list, setList] = useState<WatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<WatchItem | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editComplexNo, setEditComplexNo] = useState('');

  const load = () => {
    setLoading(true);
    fetch('/api/watchlist')
      .then(r => r.json())
      .then(d => { setList(d.watchlist ?? []); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const remove = async (id: number) => {
    await fetch('/api/watchlist', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    load();
  };

  const saveComplexNo = async (id: number) => {
    await fetch('/api/watchlist', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, complex_no: editComplexNo }) });
    setEditId(null);
    load();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-800">★ 관심단지</h1>
          <p className="text-sm text-gray-500 mt-0.5">단지 클릭 시 실거래 상세 조회 · N 버튼으로 네이버 연결</p>
        </div>

        {loading && <div className="text-center py-12 text-gray-400">불러오는 중...</div>}

        {!loading && list.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">☆</div>
            <p>등록된 관심단지가 없습니다.</p>
            <p className="text-sm mt-1">단지 상세 팝업에서 ☆ 관심단지 버튼을 눌러 추가하세요.</p>
          </div>
        )}

        <div className="space-y-2">
          {list.map(item => (
            <div key={item.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3">
                {/* 단지 정보 */}
                <button
                  className="text-left flex-1 min-w-0"
                  onClick={() => setModal(item)}
                >
                  <div className="font-semibold text-gray-900 hover:text-blue-600 transition-colors">
                    {item.apt_nm}
                  </div>
                  <div className="text-sm text-gray-500 mt-0.5">
                    {item.sgg_nm} {item.umd_nm}
                  </div>
                </button>

                {/* 네이버 complexNo */}
                <div className="flex items-center gap-2 shrink-0">
                  {editId === item.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={editComplexNo}
                        onChange={e => setEditComplexNo(e.target.value)}
                        placeholder="네이버 complexNo"
                        className="text-xs border border-gray-300 rounded px-2 py-1 w-32 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                      <button
                        onClick={() => saveComplexNo(item.id)}
                        className="text-xs bg-blue-500 text-white rounded px-2 py-1 hover:bg-blue-600"
                      >저장</button>
                      <button
                        onClick={() => setEditId(null)}
                        className="text-xs text-gray-400 hover:text-gray-600"
                      >✕</button>
                    </div>
                  ) : (
                    <>
                      {item.complex_no ? (
                        <a
                          href={`https://new.land.naver.com/complexes/${item.complex_no}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-green-600 border border-green-400 rounded px-1.5 py-0.5 hover:bg-green-50"
                          onClick={e => e.stopPropagation()}
                        >N 바로가기</a>
                      ) : (
                        <button
                          onClick={() => { setEditId(item.id); setEditComplexNo(''); }}
                          className="text-xs text-gray-400 border border-dashed border-gray-300 rounded px-1.5 py-0.5 hover:border-blue-400 hover:text-blue-500"
                        >N번호 입력</button>
                      )}
                      <button
                        onClick={() => remove(item.id)}
                        className="text-xs text-gray-300 hover:text-red-400 transition-colors"
                      >✕</button>
                    </>
                  )}
                </div>
              </div>

              <div className="text-xs text-gray-400 mt-2">
                추가일: {item.added_at.slice(0, 10)}
                {item.complex_no && <span className="ml-2 text-gray-300">· complexNo: {item.complex_no}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {modal && (
        <TradeDetailModal
          aptNm={modal.apt_nm}
          sggCd={modal.sgg_cd}
          sggName={modal.sgg_nm}
          umdNm={modal.umd_nm}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
