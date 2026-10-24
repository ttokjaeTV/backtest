// node src/test.js  (레포 루트에서) — 데이터는 옆 폴더 ../portfolio-sheet-data/data
const fs = require('fs');
const path = require('path');
const BT = require('./engine.js');
const D = path.join(__dirname, '..', '..', 'portfolio-sheet-data', 'data');

function csvMap(file, col = '종가') {
  const m = new Map();
  if (!fs.existsSync(file)) return m;
  const lines = fs.readFileSync(file, 'utf8').replace(/\r/g, '').trim().split('\n');
  const head = lines.shift().split(',');
  const ki = head.indexOf('월'), vi = head.indexOf(col);
  lines.forEach(l => { const c = l.split(','); if (c[vi]) m.set(c[ki], +c[vi]); });
  return m;
}
const fx = csvMap(path.join(D, 'history/usdkrw_month.csv'), '매매기준율');
function asset(key, w = 100) {
  const [mk, code] = key.split(':');
  let px, ccy = 'KRW';
  if (mk === 'U') { px = csvMap(path.join(D, `history/us/${code}.csv`)); ccy = 'USD'; }
  else if (fs.existsSync(path.join(D, `history/kr_etf_krx/${code}.csv`))) px = csvMap(path.join(D, `history/kr_etf_krx/${code}.csv`));
  else px = csvMap(path.join(D, `history/kr_stock/${code}.csv`));
  const dv = csvMap(path.join(D, `bt/div/${mk}/${code}.csv`), '금액');
  return { key, name: code, ccy, px, dv, w };
}
let fail = 0;
function check(label, got, want, tol) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${label}: ${(got * 100).toFixed(2)}% (기대 ${(want * 100).toFixed(2)}% ±${(tol * 100).toFixed(1)}%p)`);
}
const base = { initial: 10000000, monthly: 0, reinvest: true, rebalance: 0, fx, fxMode: 'fixed' };

// 1) 미국 — 공개 10년 총수익률 (2014-12 → 2024-12)
for (const [t, want] of [['SPY', 0.130], ['SCHD', 0.110], ['QQQ', 0.183]]) {
  const r = BT.simulate({ ...base, assets: [asset('U:' + t)], start: '2014-12', end: '2024-12' });
  check(`${t} 10년 연평균(달러 기준)`, r.cagr, want, 0.003);
}

// 2) 국내 ETF — KRX 실제 종가+세이브로 분배금 재투자  vs  네이버 분배금 보정 가격만으로 구한 값
for (const code of ['069500', '360750', '458730', '161510']) {
  const a = asset('K:' + code);
  const nv = csvMap(path.join(D, `history/kr_etf/${code}.csv`));
  const s = [...a.px.keys()].filter(m => nv.has(m) && m >= '2014-12')[0], e = '2026-09';
  const r = BT.simulate({ ...base, assets: [a], start: s, end: e });
  const nvCagr = Math.pow(nv.get(e) / nv.get(s), 12 / r.n) - 1;
  check(`K:${code} ${s}~ 총수익(KRX+분배금) vs 네이버 보정가`, r.cagr, nvCagr, 0.003);
}

// 3) 국내 주식 — 삼성전자: 네이버 분할보정가 + 단위 맞춘 배당 (가격만보다 배당만큼 높아야)
{
  const r = BT.simulate({ ...base, assets: [asset('K:005930')], start: '2014-12', end: '2024-12' });
  const pr = r.perAsset[0].priceRet;
  console.log(`  삼성전자 2014-12~2024-12 총수익 연 ${(r.cagr * 100).toFixed(2)}% · 가격만 연 ${((Math.pow(1 + pr, 1 / 10) - 1) * 100).toFixed(2)}%`);
  if (!(r.cagr > Math.pow(1 + pr, 0.1) - 1 && r.cagr - (Math.pow(1 + pr, 0.1) - 1) < 0.04)) { fail++; console.log('✗ 삼성전자 배당 기여가 비정상'); }
}

// 4) 환율: SCHD 원화 vs 달러 — 차이 ≈ 환율 변화
{
  const a = asset('U:SCHD');
  const k = BT.simulate({ ...base, fxMode: 'krw', assets: [a], start: '2014-12', end: '2024-12' });
  const u = BT.simulate({ ...base, fxMode: 'fixed', assets: [a], start: '2014-12', end: '2024-12' });
  check('SCHD 원화/달러 최종금액 비율 − 1 = 환율 변화', k.finalValue / u.finalValue - 1, fx.get('2024-12') / fx.get('2014-12') - 1, 0.0001);
}

// 5) 적립식 IRR — 가격 고정·배당 없음이면 0%
{
  const px = new Map(BT.monthsBetween('2020-01', '2024-12').map(m => [m, 100]));
  const r = BT.simulate({ ...base, monthly: 500000, initial: 0, assets: [{ key: 'X', name: 'X', ccy: 'KRW', px, dv: new Map(), w: 100 }], start: '2020-01', end: '2024-12' });
  check('가격 고정 적립식 IRR', r.irr, 0, 0.0001);
  check('가격 고정 적립식 최종금액=원금', r.finalValue / r.invested - 1, 0, 1e-9);
}

// 6) 현금 수령 — 최종(보유+현금)은 재투자보다 작거나 같고, 받은 배당 합 = 현금
{
  const a = asset('U:JEPI');
  const c = BT.simulate({ ...base, reinvest: false, assets: [a], start: '2020-06', end: '2026-09' });
  const r = BT.simulate({ ...base, reinvest: true, assets: [a], start: '2020-06', end: '2026-09' });
  console.log(`  JEPI 현금수령 최종 ${Math.round(c.finalValue).toLocaleString()} (현금 ${Math.round(c.cash).toLocaleString()}) · 재투자 ${Math.round(r.finalValue).toLocaleString()}`);
  if (Math.abs(c.cash - c.totalDiv) > 1) { fail++; console.log('✗ 현금 ≠ 배당 합'); }
  check('JEPI 시간가중 수익률은 재투자 여부와 무관', c.cagr, r.cagr, 1e-9);
}

// 6-2) 내 돈 기준(IRR) — 재투자 거치식이면 시간가중과 같고, 현금 수령이면 쌓인 현금이 놀아서 더 낮다
{
  const a = asset('U:SCHD');
  const opt = { ...base, fxMode: 'krw', assets: [a], start: '2014-12', end: '2024-12' };
  const r = BT.simulate({ ...opt, reinvest: true }), c = BT.simulate({ ...opt, reinvest: false });
  const rd = BT.simulate({ ...opt, reinvest: true, initial: 0, monthly: 500000 }), cd = BT.simulate({ ...opt, reinvest: false, initial: 0, monthly: 500000 });
  console.log(`  SCHD 거치식(원화) 재투자: 시간가중 ${(r.cagr * 100).toFixed(2)}% · 내 돈 ${(r.irr * 100).toFixed(2)}%`);
  console.log(`  SCHD 거치식(원화) 현금수령: 시간가중 ${(c.cagr * 100).toFixed(2)}% · 내 돈 ${(c.irr * 100).toFixed(2)}%`);
  console.log(`  SCHD 적립식(원화) 재투자: 시간가중 ${(rd.cagr * 100).toFixed(2)}% · 내 돈 ${(rd.irr * 100).toFixed(2)}%`);
  console.log(`  SCHD 적립식(원화) 현금수령: 시간가중 ${(cd.cagr * 100).toFixed(2)}% · 내 돈 ${(cd.irr * 100).toFixed(2)}%`);
  check('재투자 거치식 내 돈 기준 = 시간가중', r.irr, r.cagr, 1e-6);
  check('현금수령 거치식 내 돈 기준 = (최종/원금)^(1/년)−1', c.irr, Math.pow(c.finalValue / c.invested, 1 / c.years) - 1, 1e-6);
  if (!(c.irr < c.cagr)) { fail++; console.log('✗ 현금수령 내 돈 기준이 시간가중보다 낮아야 함'); }
}

// 6-3) 종목별 가격 변동 — 원화 환산이면 환율 포함, 환율 고정이면 달러 기준과 같다
{
  const a = asset('U:SCHD');
  const k = BT.simulate({ ...base, fxMode: 'krw', assets: [a], start: '2014-12', end: '2024-12' }).perAsset[0];
  const u = BT.simulate({ ...base, fxMode: 'fixed', assets: [a], start: '2014-12', end: '2024-12' }).perAsset[0];
  console.log(`  SCHD 가격 변동 원화 ${(k.priceRet * 100).toFixed(2)}% · 달러 ${(k.priceRetLocal * 100).toFixed(2)}%`);
  check('원화 가격 변동 = (1+달러 변동)×(1+환율 변동)−1', k.priceRet, (1 + k.priceRetLocal) * fx.get('2024-12') / fx.get('2014-12') - 1, 1e-9);
  check('환율 고정이면 가격 변동 = 달러 기준', u.priceRet, u.priceRetLocal, 1e-12);
}

// 7) 리밸런싱 — 50:50 두 종목, 매년 맞춘 뒤 비중이 다시 50:50
{
  const r = BT.simulate({ ...base, rebalance: 12, assets: [asset('U:SPY', 50), asset('U:TLT', 50)], start: '2014-12', end: '2024-12' });
  const v = r.perAsset.map(p => p.value), tot = v[0] + v[1];
  check('10년 뒤(120개월=리밸런싱 달) SPY 비중', v[0] / tot, 0.5, 1e-9);
  console.log(`  SPY50/TLT50 매년 리밸런싱 연 ${(r.cagr * 100).toFixed(2)}% · MDD ${(r.mdd * 100).toFixed(1)}% (${r.mddAt})`);
}

// ── 일별 (BT.simulateDaily) — 데이터는 옆 폴더 ../backtest-daily/site (gh-pages) ─────────────
const DD = path.join(__dirname, '..', '..', 'backtest-daily', 'site');
function dayMap(file, col) {
  const m = new Map();
  if (!fs.existsSync(file)) return m;
  const lines = fs.readFileSync(file, 'utf8').replace(/\r/g, '').trim().split('\n');
  lines.shift();
  lines.forEach(l => { const c = l.split(','); if (c[1]) m.set(c[0], +c[1]); });
  return m;
}
if (fs.existsSync(DD)) {
  console.log('\n── 일별 ──');
  const dfx = dayMap(path.join(DD, 'fx.csv'));
  const dasset = (key, w = 100) => {
    const [mk, code] = key.split(':');
    return { key, name: code, ccy: mk === 'U' ? 'USD' : 'KRW', px: dayMap(path.join(DD, mk, `${code}.csv`)), dv: dayMap(path.join(DD, 'div', mk, `${code}.csv`)), w };
  };
  const dbase = { ...base, fx: dfx };

  // 8) 공개 10년 총수익률 — 월별과 같은 기준
  for (const [t, want] of [['SPY', 0.130], ['SCHD', 0.110], ['QQQ', 0.183]]) {
    const r = BT.simulateDaily({ ...dbase, assets: [dasset('U:' + t)], start: '2014-12', end: '2024-12' });
    check(`${t} 10년 연평균 일별(달러 기준)`, r.cagr, want, 0.003);
  }

  // 9) 매월 말일 적립 일별 ≈ 월별 (배당 받는 시점 차이만큼만 다르다), 넣은 돈·횟수는 똑같다
  for (const keys of [['U:SCHD'], ['K:069500'], ['K:005930'], ['U:SPY', 'K:133690']]) {
    const opt = { ...base, fxMode: 'krw', initial: 0, monthly: 500000, start: '2015-01', end: '2024-12' };
    const m = BT.simulate({ ...opt, assets: keys.map(k => asset(k, 100 / keys.length)) });
    const d = BT.simulateDaily({ ...opt, fx: dfx, assets: keys.map(k => dasset(k, 100 / keys.length)), freq: 'm', day: 'L' });
    check(`${keys.join('+')} 월말 적립 일별 vs 월별 내 돈 기준`, d.irr, m.irr, 0.003);
    if (d.invested !== m.invested || d.contribCount !== m.n + 1) { fail++; console.log(`✗ ${keys} 넣은 돈 ${d.invested} vs ${m.invested} · 횟수 ${d.contribCount}`); }
  }

  // 10) 최대 낙폭 — 일별은 월말끼리보다 깊다 (S&P500 2020 코로나: 일별 약 −34%, 월별 약 −20%)
  {
    const d = BT.simulateDaily({ ...dbase, assets: [dasset('U:SPY')], start: '2019-12', end: '2020-12' });
    const m = BT.simulate({ ...base, assets: [asset('U:SPY')], start: '2019-12', end: '2020-12' });
    console.log(`  SPY 2020 MDD 일별 ${(d.mdd * 100).toFixed(1)}% (${d.mddAt}) · 월별 ${(m.mdd * 100).toFixed(1)}% (${m.mddAt})`);
    check('SPY 2020 일별 MDD', d.mdd, -0.337, 0.01);
    if (d.mddAt !== '2020-03-23') { fail++; console.log('✗ 바닥 날짜가 2020-03-23 이 아님'); }
  }

  // 11) 국내 ETF — KRX 실제 종가 + 분배금(배당락일) 재투자 = 네이버 분배금 보정가 (월별 2번과 같은 검산)
  for (const code of ['069500', '360750', '161510']) {
    const nv = dayMap(path.join(D, 'history', 'kr_etf_daily', `${code}.csv`));
    const a = dasset('K:' + code);
    const first = [...a.px.keys()].sort()[0].slice(0, 7);
    const s = first >= '2015-01' ? BT.monthsBetween(first, '2026-09')[1] : '2015-01';      // 상장 다음 달부터
    const r = BT.simulateDaily({ ...dbase, assets: [a], start: s, end: '2026-09' });
    const d0 = r.labels[0], dn = r.labels[r.n];
    if (!nv.has(d0) || !nv.has(dn)) { console.log(`  K:${code} 네이버 일봉에 ${d0}/${dn} 없음 — 건너뜀`); continue; }
    const nvCagr = Math.pow(nv.get(dn) / nv.get(d0), 1 / r.years) - 1;
    check(`K:${code} 일별 총수익(KRX+분배금) vs 네이버 보정가`, r.cagr, nvCagr, 0.003);
  }

  // 12) 적립 주기 — 매주·매일도 총투자금이 매월과 거의 같다 (±3%)
  {
    const opt = { ...dbase, fxMode: 'krw', initial: 0, monthly: 500000, assets: [dasset('U:QQQ')], start: '2015-01', end: '2024-12' };
    const m = BT.simulateDaily({ ...opt, freq: 'm', day: 25 });
    const w = BT.simulateDaily({ ...opt, freq: 'w', wd: 1 });
    const d = BT.simulateDaily({ ...opt, freq: 'd' });
    console.log(`  QQQ 적립 매월25일 ${(m.irr * 100).toFixed(2)}% (${m.contribCount}회) · 매주 월 ${(w.irr * 100).toFixed(2)}% (${w.contribCount}회) · 매일 ${(d.irr * 100).toFixed(2)}% (${d.contribCount}회)`);
    check('매주 총투자금 / 매월', w.invested / m.invested, 1, 0.03);
    check('매일 총투자금 / 매월', d.invested / m.invested, 1, 1e-9);
    check('매주 vs 매월 내 돈 기준 차이', w.irr - m.irr, 0, 0.01);
  }

  // 13) 거치식·재투자 내 돈 기준(XIRR) = 시간가중, 국내+미국 섞어도 계산된다
  {
    const r = BT.simulateDaily({ ...dbase, fxMode: 'krw', assets: [dasset('K:069500', 50), dasset('U:SPY', 50)], start: '2016-01', end: '2025-12', rebalance: 12 });
    check('국내+미국 거치식 XIRR = 시간가중', r.irr, r.cagr, 1e-5);
    const v = r.perAsset.map(p => p.value), tot = v[0] + v[1];
    console.log(`  KODEX200+SPY 매년 리밸런싱 연 ${(r.cagr * 100).toFixed(2)}% · MDD ${(r.mdd * 100).toFixed(1)}% (${r.mddAt}) · 마지막 비중 ${(v[0] / tot * 100).toFixed(1)}%`);
  }

  // ── 외부 기준값 (2026-10-24 독립 검증 때 대조한 수치. 지난 기간이라 데이터가 갱신돼도 바뀌지 않는다) ──
  console.log('\n── 외부 기준값 ──');
  const usd = new Map([['1990-01-01', 1]]);                    // 달러 그대로 (환율 1 고정)
  const udaily = { ...base, fx: usd, fxMode: 'fixed', reinvest: true, rebalance: 0, monthly: 0, freq: 'm', day: 'L' };

  // 14) 운용사 공식 연환산 총수익 (2026-09-30, 시장가 기준) — SSGA·Invesco·Schwab 상품 페이지
  //     운용사는 매수호가·매도호가 중간값·NAV 재투자, 계산기는 종가·배당락일 재투자라 0.1%p 까지 허용
  const OFFICIAL = { SPY: [15.66, 22.73, 13.66, 15.18], QQQ: [23.84, 28.05, 16.33, 20.90], SCHD: [23.32, 15.45, 9.47, 12.44] };
  for (const [t, vals] of Object.entries(OFFICIAL)) {
    [1, 3, 5, 10].forEach((y, i) => {
      const r = BT.simulateDaily({ ...udaily, initial: 10000, assets: [dasset('U:' + t)], start: `${2026 - y}-09`, end: '2026-09' });
      check(`${t} ${y}년 연환산 vs 운용사 시장가`, Math.pow(r.twr, 1 / y) - 1, vals[i] / 100, 0.001);
    });
  }

  // 15) testfol.io 같은 조건 (2026-10-24 실행) — 연평균·최대 낙폭·바닥 날짜·최종 금액
  //     testfol 은 시작일 전 마지막 거래일 종가에서 시작, 적립은 다음 달부터 매월 말일(마지막 날 제외)
  const TESTFOL = [
    ['SPY 거치 2015~2024', [['SPY', 100]], '2014-12', '2024-12', 0, 13.006, -33.700, '2020-03-23', 33969.65],
    ['SCHD 거치 2015~2024', [['SCHD', 100]], '2014-12', '2024-12', 0, 11.029, -33.367, '2020-03-23', 28472.32],
    ['QQQ 거치 2015~2024', [['QQQ', 100]], '2014-12', '2024-12', 0, 18.276, -35.123, '2022-11-03', 53588.62],
    ['SPY 2020', [['SPY', 100]], '2019-12', '2020-12', 0, 18.332, -33.700, '2020-03-23', 11837.32],
    ['SCHD50+QQQ50 매년 리밸런싱 2012~2024', [['SCHD', 50], ['QQQ', 50]], '2011-12', '2024-12', 12, 16.551, -30.227, '2020-03-23', 73283.91],
  ];
  for (const [label, al, s, e, reb, cagr, mdd, bottom, endVal] of TESTFOL) {
    const r = BT.simulateDaily({ ...udaily, initial: 10000, rebalance: reb, assets: al.map(([t, w]) => dasset('U:' + t, w)), start: s, end: e });
    check(`testfol ${label} 연평균`, r.cagr, cagr / 100, 0.0002);
    check(`testfol ${label} 최대 낙폭`, r.mdd, mdd / 100, 0.0002);
    check(`testfol ${label} 최종 금액 비율`, r.finalValue / endVal, 1, 0.0005);
    if (r.mddAt !== bottom) { fail++; console.log(`✗ testfol ${label} 바닥 ${r.mddAt} ≠ ${bottom}`); }
  }
  {
    // 시작 1만 달러 + 매월 500 → 계산기는 시작일에 9,500+500, 마지막 날 500 은 testfol 에 없으므로 뺀다
    const r = BT.simulateDaily({ ...udaily, initial: 9500, monthly: 500, assets: [dasset('U:SPY')], start: '2014-12', end: '2024-12' });
    check('testfol SPY 매월 적립 내 돈 기준(MWRR)', r.irr, 0.14126, 0.0002);
    check('testfol SPY 매월 적립 최종 금액 비율', (r.finalValue - 500) / 161178.85, 1, 0.0005);
  }

  // 16) 국내 ETF 운용사 발표 (2026-10-23 기준 누적) — 삼성자산운용·미래에셋 상품 페이지·팩트시트
  //     가격만(시장가격, 분배금 제외)은 정확히 같아야 하고, 분배금 재투자는 운용사가 기준가(NAV) 기준이라 0.5%p 까지
  const cum = (code, d0, d1) => {
    const px = dayMap(path.join(DD, 'K', `${code}.csv`)), dv = dayMap(path.join(DD, 'div', 'K', `${code}.csv`));
    const ds = [...px.keys()].filter(d => d >= d0 && d <= d1).sort();
    let sh = 1;
    ds.slice(1).forEach(d => { if (dv.has(d)) sh += sh * dv.get(d) / px.get(d); });
    const p0 = px.get(ds[0]), p1 = px.get(ds[ds.length - 1]);
    return { price: p1 / p0 - 1, total: sh * p1 / p0 - 1 };
  };
  check('KODEX 200 1년 가격 vs 시장가격', cum('069500', '2025-10-23', '2026-10-23').price, 0.6170, 0.0001);
  check('KODEX 200 상장 이후 가격 vs 시장가격', cum('069500', '2002-10-14', '2026-10-23').price, 10.2355, 0.0001);
  check('KODEX 미국S&P500 1년 가격 vs 시장가격', cum('379800', '2025-10-23', '2026-10-23').price, 0.0392, 0.0001);
  check('KODEX 200 1년 분배금 재투자 vs 기준가', cum('069500', '2025-10-23', '2026-10-23').total, 0.6353, 0.005);
  check('KODEX 미국S&P500 1년 분배금 재투자 vs 기준가', cum('379800', '2025-10-23', '2026-10-23').total, 0.0617, 0.005);
  check('TIGER 미국S&P500 3년 vs 팩트시트(2026-09-30)', cum('360750', '2023-09-27', '2026-09-30').total, 0.8481, 0.005);
  check('TIGER 미국S&P500 1년 vs 팩트시트(2026-09-30)', cum('360750', '2025-09-30', '2026-09-30').total, 0.1196, 0.005);

  // 17) 국내 배당락일 — KRX KIND 공시 (KODEX 200 분배락, 삼성전자 12월) · KRX 6월 배당락 안내 + 기사 (삼성전자 6월)
  for (const [code, day] of [['069500', '2025-04-29'], ['069500', '2025-10-30'], ['005930', '2024-12-27'], ['005930', '2024-06-27'], ['005930', '2025-06-27']]) {
    const dv = dayMap(path.join(DD, 'div', 'K', `${code}.csv`));
    const ok = dv.has(day);
    if (!ok) fail++;
    console.log(`${ok ? '✓' : '✗'} ${code} 배당락일 ${day}${ok ? ` (${dv.get(day)}원)` : ' 없음'}`);
  }
} else console.log(`\n(일별 데이터 ${DD} 가 없어 일별 검산은 건너뜀)`);

console.log(fail ? `\n실패 ${fail}건` : '\n모두 통과');
process.exit(fail ? 1 : 0);
