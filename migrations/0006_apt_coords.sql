-- 아파트 단지 좌표 캐시 (apt_seq 단위)
-- 같은 apt_seq 의 모든 거래가 같은 좌표를 공유 → apt_trades 테이블 중복 저장 회피
-- villa_trades 의 lat/lng 컬럼 패턴과 달리 별도 테이블 (정규화)
--
-- 채워주는 주체: scripts/geocode-apt.ts
-- 활용: 외부 시스템 (예: 매매사업자 오케스트레이터) 의 단지 매핑 ETL,
--       또는 향후 /api/search 응답에 좌표 join

CREATE TABLE IF NOT EXISTS apt_coords (
  apt_seq      TEXT PRIMARY KEY,
  lat          REAL NOT NULL,
  lng          REAL NOT NULL,
  source       TEXT NOT NULL,           -- 'kakao' | 'vworld' | ...
  raw_address  TEXT,                    -- 카카오에 보낸 원본 주소 (디버깅)
  geocoded_at  TEXT DEFAULT (datetime('now'))
);

-- 좌표 BBOX 필터용 (외부 nearby API · 매핑 ETL 이 사용)
CREATE INDEX IF NOT EXISTS idx_apt_coords_bbox ON apt_coords(lat, lng);
