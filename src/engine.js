/* 똑재TV 백테스트 계산기 — 계산 엔진 (화면과 분리, node 로 테스트)
 *
 * 월 단위(simulate)와 거래일 단위(simulateDaily) 두 가지. 둘 다 같은 계산 루프(run)를 쓴다.
 * 모든 값은 원화(KRW). 미국 종목은 그 시점 매매기준율로 환산한다.
 *   fxMode 'krw'  : 환율 반영 (실제 원화 투자 결과)
 *   fxMode 'fixed': 환율 효과 제외 — 시작 시점 환율로 고정 (= 달러 기준 수익률)
 *
 * 흐름 (t = 0 … n, 월별은 각 달 말 종가, 일별은 각 거래일 종가)
 *   t=0      초기 투자금 + (적립식이면) 첫 적립액을 목표 비중대로 매수
 *   t≥1      ① 그때 배당락된 배당을 받는다 (보유 주식 수 × 주당 배당 × 환율)
 *            ② 재투자면 그 종목을 다시 산다 / 현금 수령이면 현금으로 쌓는다(재투자하지 않음)
 *            ③ 적립일이면 적립액을 목표 비중대로 매수
 *            ④ 리밸런싱 시점이면 보유 평가액을 목표 비중으로 다시 맞춘다 (현금은 건드리지 않음)
 *   소수 주 매수 허용, 매매 수수료·세금 없음(세전).
 *
 * 일별(simulateDaily)에서 달라지는 것
 *   가격    거래일 종가. 여러 종목(국내·미국)을 섞으면 거래일을 합치고, 그날 거래가 없는 종목은 직전 종가.
 *   적립    freq 'm' 매월 day(1~28 또는 'L'=말일)일 · 'w' 매주 wd(1=월~5=금)요일 · 'd' 매 거래일.
 *           그날이 휴장이면 다음 거래일(매월은 그달 안, 매주는 그 주 안). 금액은 월 적립액 기준으로 나눈다:
 *           매주 = 월액 × 12 ÷ 52, 매일 = 월액 ÷ 그달 거래일 수 → 기간이 같으면 총투자금이 거의 같다.
 *   기간    start~end 달. 매월 적립이면 시작 달 매수일, 매주·매일이면 시작 달 첫 거래일부터 끝 달 마지막 거래일까지.
 *   배당    배당락일 종가에 받는다 (재투자 표준). 시작일(t=0)에 배당락된 것은 받지 않는다.
 *   리밸런싱 시작 달에서 12개월마다 그달 마지막 거래일 (월별과 같은 시점).
 *   연수익률 실제 날짜 기준 (일수 ÷ 365.25), 내 돈 기준은 날짜별 현금흐름의 IRR(XIRR).
 *
 * 성과 지표
 *   연평균 수익률(시간가중) : 돈을 넣고 뺀 시점과 무관한 '상품 자체' 성과. 배당은 받는 즉시 재투자한 것과 같다.
 *   내 돈 기준 연 수익률    : 실제로 넣은 돈의 흐름(초기·적립) → 끝 시점 최종 금액(보유 + 쌓인 배당 현금)으로 구한 IRR.
 *                             현금 수령이면 배당 현금이 이자 없이 쌓여 있다고 보므로 시간가중보다 낮게 나온다.
 *                             거치식·재투자는 시간가중과 같다. 항상 계산한다.
 *   최대 낙폭(MDD)          : 시간가중 지수 기준 고점 대비 최대 하락. 일별이면 거래일 종가 기준이라 월별보다 깊게 나온다.
 */
(function (root) {
  'use strict';

  function monthsBetween(a, b) {               // 'YYYY-MM' 포함 범위
    const out = [];
    let y = +a.slice(0, 4), m = +a.slice(5, 7);
    const ey = +b.slice(0, 4), em = +b.slice(5, 7);
    while (y < ey || (y === ey && m <= em)) {
      out.push(`${y}-${String(m).padStart(2, '0')}`);
      m++; if (m === 13) { m = 1; y++; }
    }
    return out;
  }
  const mnum = s => +s.slice(0, 4) * 12 + (+s.slice(5, 7) - 1);
  const dayNum = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;

  // 빈 달은 직전 값으로 채운다 (거래정지·휴장 등). 첫 값 이전은 없음(null).
  function fill(map, months) {
    const out = []; let last = null;
    for (const m of months) {
      if (map.has(m)) last = map.get(m);
      out.push(last);
    }
    return out;
  }
  // 일별: dates(정렬됨) 각 날짜에 그날 또는 그 이전 마지막 값. dates 이전 값도 쓴다(시작일이 휴장인 종목).
  function fillDaily(map, dates) {
    const keys = [...map.keys()].sort();
    const out = []; let j = 0, last = null;
    for (const d of dates) {
      while (j < keys.length && keys[j] <= d) last = map.get(keys[j++]);
      out.push(last);
    }
    return out;
  }

  function irrMonthly(flows) {                  // flows[t]: 그달 현금흐름(투자 = 음수)
    const npv = r => flows.reduce((s, f, t) => s + f / Math.pow(1 + r, t), 0);
    let lo = -0.99, hi = 1.0;
    if (npv(lo) * npv(hi) > 0) return null;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }
  function xirr(flows, years) {                 // years[t]: 시작부터 지난 햇수 → 연 수익률
    const idx = flows.map((f, t) => t).filter(t => flows[t] !== 0);
    const npv = r => idx.reduce((s, t) => s + flows[t] / Math.pow(1 + r, years[t]), 0);
    let lo = -0.99, hi = 10;
    if (npv(lo) * npv(hi) > 0) return null;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }

  /**
   * 공통 계산 루프. T 는 simulate / simulateDaily 가 만든다.
   *   labels   t=0…n 시점 ('YYYY-MM' 또는 'YYYY-MM-DD')
   *   P, D     종목별 가격·주당 배당 배열 (길이 n+1)
   *   fxArr    시점별 원/달러 (미국 종목이 없으면 null 이어도 됨)
   *   contrib  시점별 넣는 돈 (t=0 은 초기 투자금 포함)
   *   rebal    시점별 리밸런싱 여부
   *   years    기간(년) · irr(flows) → 연 IRR · spanMonths 시작~끝 달 수 · last12From 최근 12개월 배당 시작 t
   */
  function run(o, T) {
    const n = T.labels.length - 1;
    const wsum = o.assets.reduce((s, a) => s + a.w, 0);
    const W = o.assets.map(a => a.w / wsum);
    const needFx = o.assets.some(a => a.ccy === 'USD');
    const fx0 = needFx ? T.fxArr[0] : 1;
    const rate = (a, t) => a.ccy === 'USD' ? (o.fxMode === 'fixed' ? fx0 : T.fxArr[t]) : 1;
    const P = T.P, D = T.D;
    const krwPrice = (i, t) => P[i][t] * rate(o.assets[i], t);

    const sh = o.assets.map(() => 0);
    const buy = (amt) => { o.assets.forEach((a, i) => { sh[i] += amt * W[i] / krwPrice(i, 0 + buy.t); }); };
    let cash = 0, invested = 0, contribCount = 0;
    const flows = new Array(n + 1).fill(0);
    const rows = [];                           // 시점별 기록
    const divByAsset = o.assets.map(() => 0);
    const idx = [1];                           // 시간가중 지수

    // t = 0
    buy.t = 0;
    const first = T.contrib[0];
    if (first > 0) { buy(first); invested += first; flows[0] -= first; }
    if (T.isContrib[0]) contribCount++;
    const holdVal = t => sh.reduce((s, q, i) => s + q * krwPrice(i, t), 0);
    rows.push({ m: T.labels[0], invested, value: holdVal(0), cash, div: 0 });

    for (let t = 1; t <= n; t++) {
      buy.t = t;
      const prev = holdVal(t - 1);
      // ① 배당
      let divT = 0;
      const divI = o.assets.map((a, i) => sh[i] * D[i][t] * rate(a, t));
      divI.forEach((d, i) => { divT += d; divByAsset[i] += d; });
      const grossNow = holdVal(t) + divT;      // 배당을 포함한 이번 시점 성과 (시간가중)
      idx.push(idx[t - 1] * (prev > 0 ? grossNow / prev : 1));
      // ② 재투자 / 현금
      if (o.reinvest) divI.forEach((d, i) => { if (d > 0) sh[i] += d / krwPrice(i, t); });
      else cash += divT;
      // ③ 적립
      if (T.contrib[t] > 0) { buy(T.contrib[t]); invested += T.contrib[t]; flows[t] -= T.contrib[t]; contribCount++; }
      // ④ 리밸런싱
      if (T.rebal[t]) {
        const tot = holdVal(t);
        o.assets.forEach((a, i) => { sh[i] = tot * W[i] / krwPrice(i, t); });
      }
      rows.push({ m: T.labels[t], invested, value: holdVal(t), cash, div: divT });
    }

    const finalValue = holdVal(n) + cash;
    flows[n] += finalValue;
    const years = T.years;
    const twr = idx[n];
    const cagr = Math.pow(twr, 1 / years) - 1;
    const irr = T.irr(flows);

    // 최대 낙폭
    let peak = idx[0], mdd = 0, mddAt = T.labels[0], dd = [];
    idx.forEach((v, t) => {
      if (v > peak) peak = v;
      const d = v / peak - 1;
      dd.push(d);
      if (d < mdd) { mdd = d; mddAt = T.labels[t]; }
    });

    // 연도별 (달력 기준, 첫·마지막 해는 일부 기간)
    const years_ = [];
    const y0 = T.labels[0].slice(0, 4);
    let base = idx[0], divY = 0;
    for (let t = 1; t <= n; t++) {
      divY += rows[t].div;
      const y = T.labels[t].slice(0, 4);
      const last = t === n || T.labels[t + 1].slice(0, 4) !== y;
      if (last) {
        years_.push({
          year: y, ret: idx[t] / base - 1,
          // 시작 해는 연중에 시작했으므로 일부 기간 (12월 말 시작이면 그해 시점이 더 없어 여기 오지 않는다)
          partial: y === y0 || (t === n && T.labels[n].slice(5, 7) !== '12'),
          invested: rows[t].invested, value: rows[t].value + rows[t].cash, div: divY,
        });
        base = idx[t]; divY = 0;
      }
    }
    const fullYears = years_.filter(y => !y.partial);
    const worst = fullYears.length ? fullYears.reduce((a, b) => (b.ret < a.ret ? b : a)) : null;
    const best = fullYears.length ? fullYears.reduce((a, b) => (b.ret > a.ret ? b : a)) : null;

    const last12 = rows.slice(T.last12From).reduce((s, r) => s + r.div, 0);
    const divMonths = Math.max(1, Math.min(12, T.spanMonths));
    const totalDiv = divByAsset.reduce((s, v) => s + v, 0);

    return {
      months: T.labels, labels: T.labels, daily: !!T.daily, n, years, rows, idx, dd,
      spanMonths: T.spanMonths, contribCount, divMonths,
      invested, finalValue, holdings: holdVal(n), cash,
      cagr, irr, mdd, mddAt, twr,
      yearly: years_, worst, best,
      totalDiv, last12Div: last12, monthlyDivAvg: last12 / divMonths,
      perAsset: o.assets.map((a, i) => ({
        key: a.key, name: a.name, ccy: a.ccy, w: W[i], value: sh[i] * krwPrice(i, n), div: divByAsset[i],
        priceRet: krwPrice(i, n) / krwPrice(i, 0) - 1,   // 원화 기준 (fxMode 'fixed'면 = 달러 기준)
        priceRetLocal: P[i][n] / P[i][0] - 1,            // 상장 통화 기준 (미국 = 달러)
      })),
      fx0, fxN: needFx ? T.fxArr[n] : null,
    };
  }

  function checkWeights(o) {
    const wsum = o.assets.reduce((s, a) => s + a.w, 0);
    if (!(wsum > 0)) throw new Error('비중 합계가 0입니다.');
  }

  /**
   * 월 단위
   * @param {object} o
   *   assets   [{key, name, ccy:'KRW'|'USD', px: Map(month→price), dv: Map(month→주당배당), w: 비중%}]
   *   fx       Map(month→원/달러)
   *   start, end  'YYYY-MM'
   *   initial  초기 투자금(원)
   *   monthly  월 적립액(원) — 0 이면 거치식
   *   reinvest true=배당 재투자 / false=현금 수령
   *   rebalance 0=안 함, 12=매년
   *   fxMode   'krw' | 'fixed'
   */
  function simulate(o) {
    const months = monthsBetween(o.start, o.end);
    const n = months.length - 1;
    if (n < 1) throw new Error('기간이 너무 짧습니다 (최소 2개월).');
    checkWeights(o);
    const fxArr = fill(o.fx || new Map(), months);
    const needFx = o.assets.some(a => a.ccy === 'USD');
    if (needFx && fxArr.some(v => v == null)) throw new Error('환율 자료가 없는 기간이 포함돼 있습니다 (1990-03 이후만 가능).');
    const P = o.assets.map(a => fill(a.px, months));
    P.forEach((p, i) => { if (p[0] == null) throw new Error(`${o.assets[i].name}: 시작 달 가격이 없습니다.`); });
    const D = o.assets.map(a => months.map(m => (a.dv && a.dv.get(m)) || 0));
    const contrib = months.map((m, t) => (t === 0 ? o.initial + o.monthly : o.monthly));
    return run(o, {
      labels: months, P, D, fxArr, contrib,
      isContrib: months.map(() => o.monthly > 0),
      rebal: months.map((m, t) => !!(o.rebalance && t % o.rebalance === 0) && t > 0),
      years: n / 12,
      irr: flows => { const r = irrMonthly(flows); return r == null ? null : Math.pow(1 + r, 12) - 1; },
      spanMonths: n, last12From: Math.max(1, n - 11),
    });
  }

  /**
   * 거래일 단위 — 위 simulate 와 같은 입력에 더해
   *   assets[].px / dv  Map('YYYY-MM-DD' → 종가 / 배당락일 주당배당)
   *   fx       Map('YYYY-MM-DD' → 원/달러)
   *   freq     'm' | 'w' | 'd'   (적립 주기)
   *   day      매월 적립일 1~28 또는 'L'(말일, 기본)
   *   wd       매주 적립 요일 1=월 … 5=금 (기본 1)
   */
  function simulateDaily(o) {
    checkWeights(o);
    const freq = o.freq || 'm', day = o.day == null ? 'L' : o.day, wd = o.wd || 1;
    const lo = `${o.start}-01`, hi = `${o.end}-31`;
    const set = new Set();
    o.assets.forEach(a => a.px.forEach((v, d) => { if (d >= lo && d <= hi && v > 0) set.add(d); }));
    const all = [...set].sort();
    if (!all.length) throw new Error('선택한 기간에 거래일이 없습니다.');
    const byMonth = new Map();
    all.forEach(d => { const m = d.slice(0, 7); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(d); });
    if (!byMonth.has(o.start)) throw new Error(`${o.assets[0].name}: 시작 달 가격이 없습니다.`);

    // 적립일
    const plan = new Map();                     // 날짜 → 적립액
    const months = monthsBetween(o.start, o.end).filter(m => byMonth.has(m));
    if (freq === 'm') {
      months.forEach(m => {
        const ds = byMonth.get(m);
        const d = day === 'L' ? ds[ds.length - 1] : (ds.find(x => +x.slice(8, 10) >= +day) || ds[ds.length - 1]);
        plan.set(d, o.monthly);
      });
    } else if (freq === 'w') {
      const amt = o.monthly * 12 / 52;
      const seen = new Set();
      all.forEach(d => {
        const dn = dayNum(d), dow = ((new Date(dn * 864e5).getUTCDay() + 6) % 7) + 1;   // 1=월 … 7=일
        const week = dn - (dow - 1);
        if (dow >= wd && !seen.has(week)) { seen.add(week); plan.set(d, amt); }
      });
    } else {
      months.forEach(m => { const ds = byMonth.get(m); ds.forEach(d => plan.set(d, o.monthly / ds.length)); });
    }
    const t0d = freq === 'm' ? [...plan.keys()].sort()[0] : all[0];    // 매월: 시작 달 매수일, 매주·매일: 시작 달 첫 거래일
    const dates = all.filter(d => d >= t0d);
    const n = dates.length - 1;
    if (n < 1) throw new Error('기간이 너무 짧습니다.');
    if (mnum(o.end) - mnum(o.start) < 1) throw new Error('기간이 너무 짧습니다 (최소 2개월).');

    const fxArr = fillDaily(o.fx || new Map(), dates);
    const needFx = o.assets.some(a => a.ccy === 'USD');
    if (needFx && fxArr.some(v => v == null)) throw new Error('환율 자료가 없는 기간이 포함돼 있습니다 (1990-03 이후만 가능).');
    const P = o.assets.map(a => fillDaily(a.px, dates));
    P.forEach((p, i) => { if (p[0] == null) throw new Error(`${o.assets[i].name}: 시작일 가격이 없습니다.`); });
    // 배당: 배당락일이 날짜축에 없으면(그 종목만 거래) 다음 시점에 붙인다. t=0 이하는 받지 않는다.
    const pos = new Map(dates.map((d, t) => [d, t]));
    const D = o.assets.map(a => {
      const arr = new Array(n + 1).fill(0);
      (a.dv || new Map()).forEach((v, d) => {
        if (d <= dates[0] || d > dates[n]) return;
        let t = pos.get(d);
        if (t == null) { t = dates.findIndex(x => x > d); if (t < 0) return; }
        arr[t] += v;
      });
      return arr;
    });
    const contrib = dates.map(d => plan.get(d) || 0);
    contrib[0] += o.initial;
    const isContrib = dates.map(d => o.monthly > 0 && plan.has(d));
    // 리밸런싱: 시작 달에서 12개월마다 그달 마지막 거래일
    const rebal = dates.map(() => false);
    if (o.rebalance) {
      const lastOf = new Map(); dates.forEach((d, t) => lastOf.set(d.slice(0, 7), t));
      const s = mnum(o.start);
      lastOf.forEach((t, m) => { const k = mnum(m) - s; if (k > 0 && k % o.rebalance === 0 && t > 0) rebal[t] = true; });
    }
    const yrs = dates.map(d => (dayNum(d) - dayNum(dates[0])) / 365.25);
    const span = mnum(dates[n].slice(0, 7)) - mnum(o.start);
    const endM = mnum(dates[n].slice(0, 7));
    let last12From = dates.findIndex(d => mnum(d.slice(0, 7)) > endM - 12);
    last12From = Math.max(1, last12From);
    return run(o, {
      labels: dates, P, D, fxArr, contrib, isContrib, rebal, daily: true,
      years: yrs[n],
      irr: flows => xirr(flows, yrs),
      spanMonths: span, last12From,
    });
  }

  const api = { simulate, simulateDaily, monthsBetween, irrMonthly, xirr };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BT = api;
})(typeof window !== 'undefined' ? window : globalThis);
