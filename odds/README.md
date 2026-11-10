# AU 盤口與 EV 分析

第二期採用「後端定時抓取 → 靜態快照 → 前端分析」。瀏覽器不接觸 API key，不直接呼叫付費 API。

## 真實接駁

1. 在執行 Python 的環境安全設定 `ODDS_API_KEY`（或在 GitHub repository Secrets 新增同名 secret）。請勿將金鑰提交 Git、貼入聊天、放入命令列參數或使用 `VITE_*` 變數。
2. 允許對 `api.the-odds-api.com` 的 HTTPS 存取；使用環境提供的 proxy／CA，不停用 TLS 驗證。
3. 先跑第一期 ETL，再從專案根目錄執行：

```bash
.venv/bin/python -m odds.fetch
cd web
npm run build
```

缺少金鑰時 CLI 會回報並退出，保留舊快照；網站仍可正常使用第一期並顯示「未接駁」。`npm run dev` / `npm run build` 只會在 `data/odds.json` 不存在時建立空的未接駁快照，絕不覆蓋已有的報價。

## 費用與排程

collector 先呼叫 `/v4/sports/basketball_nba/events`，只選目標布里斯本日期尚未開波的賽事，再逐場呼叫 `/events/{id}/odds`。固定 `regions=au`、`oddsFormat=decimal`，莊家 Sportsbet / TAB，市場得分、籃板、助攻、三分及 PRA。

預設限制最多 16 場、預估最多 100 credits，每場預估 5 個市場 × 1 region。實際用量以上游帳戶及 response headers 為準；限制只是客戶端保護，不是供應商的費用保證。不自動重試付費請求；HTTP 401/403/422/429、網絡或驗證失敗全部保留舊檔。

同一 AEST 目標日預設只成功抓取一次；額外抓取必須顯式 `--force`（會額外使用額度）。可指定 `--date YYYY-MM-DD`、`--max-events`、`--max-credits`。不要指定過去日期作歷史 API 查詢：此 collector 只抓尚未開波的現有 events，不提供歷史 API 付費端點。

`.github/workflows/odds.yml` 每日 23:07 UTC（翌日 09:07 AEST）執行，先更新 box score，再抓盤口、測試、build。`workflow_dispatch` 的 `force_refresh` 預設關閉。此檔案僅定義未來工作，不會自動發布網站；GitHub Actions 排程也可能延遲。比賽提早開波時需自行安排更早的抓取時間。

## 格式與歷史

`data/odds.json` 是原子替換的公開前端快照，含 `schema_version`、抓取時間、目標日、事件數、用量、`rows`、`issues`、近 30 日（最多 50,000 列）歷史報價。沒有 API key 或 API 原始回應。

每個成功抓取亦寫入 `.cache/odds/{UTC時間}.json` 和同名 CSV；CSV 固定欄位：

```csv
fetched_at,game_id,bookmaker,player_name,market,line,over_price,under_price
```

`event_id` 是 Odds API ID；`game_id` 只會在「主客隊 + 開波時間相差最多 6 小時」可唯一對應 ESPN 賽程時填入，絕不混用兩個來源的 ID。無法唯一對應的報價保留但不計 EV。

所有 event 抓取成功並完整驗證後，才替換對外 `odds.json`；任何一場失敗會保留整份原快照。失敗前已發出的 API 呼叫可能已消耗額度。

## 球員對應

去重音、去標點、小寫，移除結尾 Jr./Sr./II/III/IV 後作唯一匹配。同名歧義、未知球員絕不模糊配對。以 `aliases.json` 手動設定「API 名字 → ESPN pid（字串）」；目的 pid 必須存在於今季有效球員名單。

```json
{"API 球員別名": "3945274"}
```

## 計算與畫面

- 同一莊家、同一球員、市場及原始盤口才可配對 Over / Under；不能把不同莊家兩邊拼成去水機率。
- 去水 `fair_over=(1/over)/(1/over+1/under)`；預設估計 `0.5×L10 + 0.3×今季 + 0.2×上季`。缺失視窗按有效權重重分配。權重可在「今晚 EV 排行」修改並儲存在本機。
- `edge=p_est-p_fair`，`EV=p_est×decimal_odds-1`。細盤用半分盤的補集機率。
- 只把尚未開波、抓取與莊家更新未超過 24 小時、有唯一對應且為 .5 盤口的報價納入排行。整數盤保留顯示，但有打和的可能，不能把其賠率套在正規化後 .5 盤的無打和 EV 公式上。
- 按球員、事件、市場、盤口分組，顯示方向所對應的最佳莊家賠率，再按 EV 降序；點列會用 `#player/{pid}/{stat}/{line}` 帶入分析。
- 球員頁並排顯示各莊家原始盤口及大／細賠率，可帶入分析；歷史紀錄及折線圖顯示盤口變動。單一快照無法畫走勢；同莊家同時有多個替代盤口時不臆造一條主線，圖中留空，表格完整顯示。
- 所有畫面顯示抓取時間與免責說明。測試只使用標有「測試快照 · 非真實盤口」的攔截資料，不會寫進實際 `data/odds.json`。

## 測試

```bash
.venv/bin/pytest -q
cd web
npm test
npm run build
npm run test:e2e
```

測試涵蓋 API schema、事件身份、名字重音／歧義、配對、額度、時區、錯誤保留、歷史、去水／EV、權重、深連結、損壞快照與 400px 手機頁面。測試不會呼叫付費 API。未設定真實金鑰前，真實供應商回應、訂閱是否包含市場、Sportsbet／TAB 實際供應及可用額度均未驗證。
