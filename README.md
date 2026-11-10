# NBA / PROPS

單人用 NBA 球員 props 分析工具。React / Vite + Python ETL，繁體中文粵語介面，布里斯本 AEST（UTC+10）。

## 本地啟動

需要 Python 3.12、Node.js 24、Git；不需要 API key 或資料庫。

```bash
cd /workspace/NBA  # 或你自己的 checkout 路徑
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
PYTHON=.venv/bin/python bash etl/fetch.sh
cd web
npm ci
npm run dev
```

瀏覽器開啟 Vite 印出的本機位址。ETL 會拉取 `sportsdataverse/hoopR-nba-data` 的兩季球員及今季賽程 parquet；首次 sparse checkout 仍可能下載 Git metadata，不保證小於 1 MB。上游來源預設固定 2025–26 / 2026–27；換季需同步更改 ETL 與 `model.js` 的球季設定。

數據未就緒時顯示明確錯誤及 ETL 指令，不會用虛構球員或模擬統計冒充真實資料。

## 功能

- 30 隊東西岸／六分區、戰績、下一場、AEST 每日賽程。
- 依近 5 場分鐘排序的陣容、上場時間下降提示、12 個分析項目。
- 可搜尋／各欄排序的球員篩選表（今季至少 3 場）。
- 球員分析：6 個歷史過盤視窗、.5 盤口／拉桿／預設重設、10/20/40 場圖表、分鐘走勢、對手防守／往績、兩季逐場紀錄。
- `#teams`、`#team/LAL`、`#player/3945274` 深連結，重新整理可復原；深淡色主題保存在本機。
- 第二期已加入 Sportsbet / TAB 賠率比較、今晚 EV 排行、可調權重與盤口變動圖；沒有金鑰或快照時顯示「未接駁」。`ODDS_API_KEY` 留空可完整使用第一期；將來只放後端，切勿用 `VITE_*` 公開 key。

## 數據與更新安全

`data/` 存三個 CSV、metadata 與供前端一次讀取的 atomic `snapshot.json`。不把原始數據或生成數據提交 Git。

ETL 只保留常規賽、排除 DNP／零分鐘，保留今季有上場球員的兩季資料。球員及比賽 ID 為文字。每次先完整驗證再原子替換，UI 永遠只讀一份完整 snapshot。健康檢查涵蓋 schema、空資料、重複球員／比賽、今季列數不能倒退，以及最新美國比賽日期不得超過兩日。失敗拋錯並保留舊檔；完全無新增時不寫檔。前端根據最新比賽日顯示過期標記。

測試歷史資料可顯式指定 `--as-of 2026-11-09T12:00:00Z`；`--allow-stale` 僅供離線歷史分析，不在每日工作流程使用。

`.github/workflows/daily.yml` 每日 17:37 UTC（翌日 03:37 AEST）執行，恢復上一份有效資料作健康檢查基線，成功才快取及生成私有 build artifact；失敗不替換已部署版本。GitHub Actions 排程有機會延遲，並非保證準時。

## 測試及 build

```bash
.venv/bin/pytest -q
.venv/bin/python etl/acceptance.py --source .cache/hoopr
cd web
npm test
npm run build
npm run test:e2e
```

`acceptance.py` 對 2026-11-07 截日資料核對設計方案第 9 節全部 14 個數值要求，之後新增的球員不會污染舊快照。上游若修訂歷史資料，應調查差異，不要直接改預期值。

瀏覽器驗證使用系統 Chromium + Playwright，涵蓋 1440px 桌面及 400px 手機、三層導航、搜尋、盤口正規化／換項目重設、重新整理深連結、深色模式及快速拉動滑桿。可從 `web/` 用 `npm exec playwright --version` 確認工具。`npm run test:e2e` 會測試 production build；先執行 ETL 與 build。系統未裝 Chromium 時先執行 `npx playwright install chromium`，亦可用 `CHROMIUM_PATH` 指定瀏覽器路徑。

## 部署

`web/dist/` 是靜態產物，包含個人使用的衍生數據，請放在自己的私有靜態主機或有登入保護的服務；勿公開重新發布來源原始數據。每日 Actions artifact 可下載後部署至同一主機。本專案不會自動發布網站或推送資料。

若使用子路徑，build 時傳 `npm run build -- --base=/NBA/`；資料請求會遵循 Vite base。SPA 導航全用 hash，不需伺服器 rewrite。每次更新需重新執行 ETL 與 build；保留上一個成功部署供回復。

環境變數：`TZ=Australia/Brisbane`（排程）、`PYTHON`（可指定虛擬環境 Python）、`ODDS_API_KEY`（第二期 Python collector 使用，前端不讀取）。

本工具只供個人歷史分析，未計傷病、輪替或上場時間變動；不是投注建議。

## 第二期接駁

完整說明見 [odds/README.md](odds/README.md)。設定後端 `ODDS_API_KEY` 並允許 `api.the-odds-api.com` 後，從根目錄執行 `.venv/bin/python -m odds.fetch`；每日 09:07 AEST 排程定義於 `.github/workflows/odds.yml`。目前未配置金鑰，因此真實供應商請求尚未驗證；離線與瀏覽器測試不會花費 API 額度。

## Vercel + Supabase

新專案建立、私有資料、登入白名單、部署及每日更新的完整步驟見 [deploy/README.md](deploy/README.md)。已提供根目錄 `vercel.json`、Supabase migration、後端快照上傳器及雲端模式測試；尚未建立帳戶／專案時仍可用原有本機模式開發。
