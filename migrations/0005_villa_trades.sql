-- 연립다세대(빌라) 매매 실거래 데이터
-- 국토부 RTMSDataSvcRHTrade API 적재용
CREATE TABLE IF NOT EXISTS villa_trades (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 식별자/위치
  mhouse_nm       TEXT,                  -- 단지명 (모호, 누락 흔함)
  sgg_cd          TEXT NOT NULL,         -- 시군구코드 (5자리)
  umd_nm          TEXT,                  -- 법정동명
  jibun           TEXT,                  -- 지번 (좌표 매칭 키)
  road_nm         TEXT,                  -- 도로명
  -- 단지/물건 정보
  build_year      INTEGER,               -- 건축년도
  house_type      TEXT,                  -- 연립/다세대 구분
  exclu_use_ar    REAL NOT NULL,         -- 전용면적(㎡)
  area_group      INTEGER,               -- 전용면적 반올림 (그룹핑용)
  land_ar         REAL,                  -- 대지권면적(㎡)
  floor           INTEGER,               -- 층
  -- 거래 정보
  deal_amount     INTEGER NOT NULL,      -- 거래금액(만원)
  deal_date       TEXT NOT NULL,         -- 계약일 (YYYY-MM-DD)
  dealing_gbn     TEXT,                  -- 거래유형 (중개/직거래)
  cdeal_type      TEXT,                  -- 해제여부 (Y=해제)
  cdeal_day       TEXT,                  -- 해제사유발생일
  rgst_date       TEXT,                  -- 등기일자
  -- 좌표 (지오코딩 결과 캐시)
  lat             REAL,                  -- 위도
  lng             REAL,                  -- 경도
  -- 메타
  collected_at    TEXT DEFAULT (datetime('now'))
);

-- 중복 방지 유니크 인덱스
-- (sgg_cd + jibun + mhouse_nm + 거래정보) 로 동일 거래 식별
CREATE UNIQUE INDEX IF NOT EXISTS idx_villa_unique
  ON villa_trades(sgg_cd, jibun, mhouse_nm, deal_date, floor, exclu_use_ar, deal_amount);

-- 지역 조회용
CREATE INDEX IF NOT EXISTS idx_villa_sgg_cd ON villa_trades(sgg_cd);
CREATE INDEX IF NOT EXISTS idx_villa_deal_date ON villa_trades(deal_date);

-- 좌표 BBOX 필터용 (외부 nearby API 가 사용)
CREATE INDEX IF NOT EXISTS idx_villa_bbox ON villa_trades(lat, lng);

-- 해제거래 제외용
CREATE INDEX IF NOT EXISTS idx_villa_cdeal ON villa_trades(cdeal_type);

-- 단지 단위 조회용
CREATE INDEX IF NOT EXISTS idx_villa_group ON villa_trades(mhouse_nm, sgg_cd);


-- 지오코딩 캐시 (지번 → 좌표, 영구 보관)
-- 한 지번은 영원히 같은 좌표 → 한 번 변환하면 재호출 불필요
CREATE TABLE IF NOT EXISTS jibun_coords (
  sgg_cd      TEXT NOT NULL,
  umd_nm      TEXT NOT NULL,
  jibun       TEXT NOT NULL,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  source      TEXT NOT NULL,           -- 'kakao' | 'vworld'
  raw_address TEXT,                    -- 지오코딩에 보낸 원본 주소 (디버깅용)
  geocoded_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY(sgg_cd, umd_nm, jibun)
);

CREATE INDEX IF NOT EXISTS idx_jibun_coords_bbox ON jibun_coords(lat, lng);
