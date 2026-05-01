import https from 'https';

const KEY = process.env.MOLIT_API_KEY;
const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${KEY}&LAWD_CD=26350&DEAL_YMD=202601&numOfRows=3&pageNo=1`;

async function test(label, headers) {
  const result = await new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data.slice(0, 120) }));
    });
    req.on('error', reject);
  });
  console.log(`[${label}] ${result.status}: ${result.body}`);
}

await test('기본', {});
await test('Origin 추가', { 'Origin': 'https://www.data.go.kr' });
await test('Referer 추가', { 'Referer': 'https://www.data.go.kr/' });
await test('Origin+Referer', { 'Origin': 'https://www.data.go.kr', 'Referer': 'https://www.data.go.kr/' });
