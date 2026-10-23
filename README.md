# 똑재TV 백테스트 계산기

사이트: https://ttokjaetv.github.io/backtest/

- 화면: `index.html` (빌드 결과) ← `src/` (template.html · base.css · extra.css · engine.js · app.js · build.py · test.js)
  - 고친 뒤 `python src/build.py`, 계산 검증 `node src/test.js`
- 데이터는 이 저장소에 없다.
  - 월별(전 종목): [ttokjaeTV/portfolio-sheet-data](https://github.com/ttokjaeTV/portfolio-sheet-data) 의 `data/` — `app.js` 의 `DATA = '/portfolio-sheet-data/data/'`
  - 일별(주요 종목 약 1,500개): [ttokjaeTV/backtest-daily](https://github.com/ttokjaeTV/backtest-daily) 의 gh-pages — `DAILY_DATA = '/backtest-daily/'`
  - 둘 다 같은 ttokjaetv.github.io 주소라 CORS 없음. 데이터 갱신은 각 저장소의 워크플로가 맡는다.
- 계산 방식: 고른 종목이 **모두 일별 대상**이면 `BT.simulateDaily`(거래일 종가, 적립 주기 매월·매주·매일, 배당락일 배당), 아니면 `BT.simulate`(월말 종가). 두 함수는 같은 계산 루프를 쓴다(`engine.js` 의 `run`).
  - 월별 결과는 2026-10-24 일별 추가 전과 504개 조합에서 소수점까지 같다.
- 로컬 검증: `test.js` 가 옆 폴더 `../portfolio-sheet-data/data` 와 `../backtest-daily/site` 를 읽는다 (세 저장소를 `Desktop\Claude\github\` 아래 나란히 둘 것)
- 로컬에서 화면 보기: `github\` 폴더를 사이트 루트로 띄우되 `/backtest-daily/` 는 `backtest-daily/site/` 로 연결해야 한다 → http://localhost:포트/backtest/
- 2026-10-23 portfolio-sheet-data/backtest 에서 기록째 분리. 예전 주소 `/portfolio-sheet-data/backtest/` 는 이곳으로 넘기는 안내 페이지.
