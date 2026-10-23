# 똑재TV 백테스트 계산기

사이트: https://ttokjaetv.github.io/backtest/

- 화면: `index.html` (빌드 결과) ← `src/` (template.html · base.css · extra.css · engine.js · app.js · build.py · test.js)
  - 고친 뒤 `python src/build.py`, 계산 검증 `node src/test.js`
- 데이터는 이 저장소에 없다. [ttokjaeTV/portfolio-sheet-data](https://github.com/ttokjaeTV/portfolio-sheet-data) 의 `data/` 를 그대로 읽는다.
  - 사이트: `app.js` 의 `DATA = '/portfolio-sheet-data/data/'` (같은 ttokjaetv.github.io 주소라 CORS 없음)
  - 로컬 검증: `test.js` 가 옆 폴더 `../portfolio-sheet-data/data` 를 읽는다 (두 저장소를 `Desktop\Claude\github\` 아래 나란히 둘 것)
  - 데이터 갱신(`data/bt/`, `data/history/`)은 portfolio-sheet-data 의 `backtest-data.yml` 이 맡는다
- 로컬에서 화면 보기: `github\` 폴더에서 `python -m http.server 8000` → http://localhost:8000/backtest/
- 2026-10-23 portfolio-sheet-data/backtest 에서 기록째 분리. 예전 주소 `/portfolio-sheet-data/backtest/` 는 이곳으로 넘기는 안내 페이지.
