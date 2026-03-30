export interface Region {
  sgg_cd: string;
  sido_nm: string;
  sido_cd: string;
  sgg_nm: string;
}

export interface SearchParams {
  sgg_codes: string[];       // 선택된 구/군 코드 목록
  date_from: string;         // YYYY-MM-DD
  date_to: string;           // YYYY-MM-DD
  price_min?: number;        // 만원
  price_max?: number;        // 만원
  diff_amount?: number;      // 변동폭 최소 (만원)
  diff_rate?: number;        // 변동률 최소 (%)
  diff_operator: 'AND' | 'OR';
  build_year_from?: number;
  build_year_to?: number;
  dealing_gbn?: '중개' | '직거래' | '';
  buyer_gbn?: '법인' | '개인' | '';
  exclude_cancelled: boolean;
  min_trade_count: number;
}

export interface TradeResult {
  apt_nm: string;
  sgg_cd: string;
  umd_nm: string;
  area_group: number;
  build_year: number | null;
  trade_count: number;
  min_price: number;
  max_price: number;
  diff_amount: number;
  diff_rate: number;
}

export interface SidoGroup {
  sido_cd: string;
  sido_nm: string;
  regions: Region[];
}
