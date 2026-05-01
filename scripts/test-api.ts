/**
 * API 테스트 스크립트
 * 실행: npx tsx scripts/test-api.ts
 */
import axios from 'axios';

const API_KEY = process.env.MOLIT_API_KEY!;

async function test() {
  console.log('=== API 테스트 ===');
  console.log('API_KEY:', API_KEY ? API_KEY.substring(0, 10) + '...' : '없음!');

  const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${API_KEY}&LAWD_CD=11680&DEAL_YMD=202501&numOfRows=3&pageNo=1`;

  console.log('\n1) fetch 기본 호출...');
  try {
    const res1 = await fetch(url);
    const text1 = await res1.text();
    console.log('상태코드:', res1.status);
    console.log('응답:', text1.substring(0, 200));
  } catch (e) {
    console.error('오류:', e);
  }

  console.log('\n2) axios 호출...');
  try {
    const res2 = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/xml, text/xml, */*',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://www.data.go.kr/',
      },
      responseType: 'text',
    });
    console.log('상태코드:', res2.status);
    console.log('응답:', String(res2.data).substring(0, 300));
  } catch (e: unknown) {
    if (axios.isAxiosError(e)) {
      console.error('axios 오류:', e.response?.status, e.response?.data?.toString().substring(0, 200));
    } else {
      console.error('오류:', e);
    }
  }
}

test();
