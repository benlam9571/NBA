# NBA 球員 Props 分析工具 — 設計方案（供 Codex 實作）

Nov 10, 2026 · @benlam

## 1. 目標與範圍

本工具是一個 NBA 球員 props（球員數據盤口）分析網站：以兩季逐場 box score 計算每個球員在任何 .5 盤口下的歷史過盤率，輔助使用者判斷大／細盤。單一使用者，介面語言為繁體中文（粵語用字），時區以布里斯本（AEST, UTC+10，無夏令時間）顯示。

三層導航結構：

1. **全部球隊**：30 隊按東西岸→分區排列，附今季戰績與下一場賽事；頂部另有逐日賽程列。
2. **球隊陣容**：單一球隊的球員卡列表，按近 5 場上場時間排序。
3. **球員分析**：單一球員單一項目的過盤率、逐場圖表、上場時間趨勢、對手防守與逐場紀錄。

支援 12 個分析項目：pts、reb、ast、fg3m（三分命中）、pra、pr、pa、ra、stl、blk、stk（抄截+封阻）、tov。

第一期**不包含**：即時比分、受傷名單、首發變動、莊家盤口與賠率（第二期以 The Odds API 接入，見第 6 節）、投注下單功能。

## 2. 數據來源

所有比賽數據來自公開的 GitHub 數據庫 [sportsdataverse/hoopR-nba-data](https://github.com/sportsdataverse/hoopR-nba-data)（ESPN box score，每日更新數次，最後一次約 16:30 UTC）。NBA 官方 stats API 與 Basketball-Reference 常被防爬虧擋住，不作來源。

需要的檔案（parquet，建議 sparse checkout 只拉這幾個）：

| 檔案 | 內容 | 備註 |
| --- | --- | --- |
| `nba/player_box/parquet/player_box_2026.parquet` | 2025-26 球員逐場 | 檔名年份 = 球季結束年 |
| `nba/player_box/parquet/player_box_2027.parquet` | 2026-27 球員逐場 | 每日更新 |
| `nba/schedules/parquet/nba_schedule_2027.parquet` | 2026-27 賽程 | 含已完場旗標 |

拉取指令（每次重新 shallow clone 即可，repo 約數百 MB，sparse 後只下載 <1 MB）：

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 --filter=blob:none --no-checkout \
  https://github.com/sportsdataverse/hoopr-nba-data repo
cd repo
git sparse-checkout init --no-cone
git sparse-checkout set "nba/player_box/parquet/*202[67]*" "nba/schedules/parquet/*2027*"
git checkout
```

球隊靜態資料（建置一次，存成 `nba_teams.csv`）：30 隊的縮寫、全名、簡稱（如 Lakers）、東／西岸、分區（NBA 現行六分區）及其中文名、ESPN 主色與副色（hex）。全名、簡稱與顏色直接取自 player\_box 的 `team_display_name`、`team_name`、`team_color`、`team_alternate_color` 欄。注意 ESPN 縮寫與其他網站不同：GS、NY、NO、SA、UTAH、WSH、PHX。

球隊 icon 不用官方 logo（商標問題）：用圓形徽章——主色作底、縮寫居中、副色作底線；字色按底色亮度（relative luminance > 0.6 用深色字，否則白字）。

盤口與賠率（第二期）：[The Odds API](https://the-odds-api.com)，澳洲莊家（Sportsbet、TAB）在 `regions=au`；詳見第 6 節。

## 3. ETL 處理規則與輸出 schema

用 Python（pandas + pyarrow）把 parquet 轉成兩個 CSV。過濾規則必須完全照做，否則後面的驗收數字對不上。

**nba\_gamelogs.csv**（球員逐場）：

1. 只保留 `season_type == 2`（常規賽；3 = 季後賽、5 = 附加賽，全部捨棄）。
2. 剔除 `did_not_play == true` 及 `minutes` 空值或 0 的列（DNP／未上場）。
3. 兩季合併後，只保留今季（2026-27）有上過場的球員的列（含他們上季的場次）。
4. 數值欄轉整數；`athlete_id` 轉文字（先轉 int64 再轉 str，避免 `3945274.0` 這類浮點尾巴）。
5. 按 `date, game_id, team, player` 排序輸出。

欄位對應（parquet 欄 → CSV 欄）：`athlete_id→pid`、`athlete_display_name→player`、`athlete_position_abbreviation→pos`（只有 G／F／C 三種）、`team_abbreviation→team`、`opponent_team_abbreviation→opp`、`game_id`、`game_date→date`（YYYY-MM-DD，美國日期）、`minutes→min`、`points→pts`、`rebounds→reb`、`assists→ast`、`three_point_field_goals_made→fg3m`、`steals→stl`、`blocks→blk`、`turnovers→tov`、`field_goals_attempted→fga`、`three_point_field_goals_attempted→fg3a`、`free_throws_attempted→fta`。另衍生：`season`（"2025-26" 或 "2026-27"）、`ha`（home\_away→H／A）、`wl`（team\_winner→W／L）、`start`（starter→1／0）。

CSV 標頭順序固定：

```csv
season,date,game_id,pid,player,pos,team,opp,ha,wl,start,min,pts,reb,ast,fg3m,stl,blk,tov,fga,fg3a,fta
2026-27,2026-11-06,401909931,3945274,Luka Doncic,G,LAL,POR,H,W,1,38,53,7,8,4,2,0,3,28,10,14
```

**nba\_schedule\_upcoming.csv**（未打賽程）：`season_type == 2` 且 `status_type_completed == false`，取未來 60 日內；欄位 `date,tip,game_id,home,away`，其中 `tip` 為含時區偏移的 ISO 時間（如 `2026-11-08T18:00-0500`，取自 `game_date_time`），按 tip 排序。

## 4. 衍生數據表與計算公式

全部由 nba\_gamelogs.csv＋nba\_schedule\_upcoming.csv＋nba\_teams.csv 算出，可以在前端或後端計算，但公式不變。

**player\_games**：逐場加組合欄 `pra = pts+reb+ast`、`pr`、`pa`、`ra`、`stk = stl+blk`。每個球員另計 `n` = 由最近一場數起的場次序號（1 = 最近，**跨兩季連續**；同日多場以 game\_id 大者為近）。

**視窗定義**（過盤率與平均均用同一套）：

| 視窗 | 條件 |
| --- | --- |
| l5 / l10 | `n <= 5` / `n <= 10`（跨季） |
| szn / prev | `season == "2026-27"` / `"2025-26"` |
| home / away | 今季且 `ha == "H"` / `"A"` |

**hit\_grid**（過盤率）：每個球員 × 12 項目 × 盤口，盤口由 0.5 起每次 +1，直到該球員該項目兩季最高值 +0.5。每個視窗記 `n`（場數）、`over`（`數值 > line` 的場數；盤口全為 .5，沒有打和）、`rate = over/n`（n=0 為 null）。全聯盟約 84,000 列——效能注意事項見第 7 節。

**player\_summary**：每個球員 × 項目一列：各視窗平均、今季中位數、`gp`（今季場數）、`gp_prev`、`diff = l5_avg − szn_avg`（手感指標）、上場時間 `l5_min`、`szn_min`、`prev_min`。球員的 `team`／`pos` 以最近一場為準（處理季中交易）。

**opp\_def**（對手防守）：只用今季數據。對每隊 T：找出所有 `opp == T` 的列（即 T 的對手球員），按項目加總再除以 T 打過的場數，得每場容許值；分組：all 及 G／F／C（用對手球員的 pos）。每組另計 `rank`（1 = 容許最多 = 最好打）和 `vs_avg` = 與 30 隊平均的差。

**next\_game**：每隊在「數據最後一場日期」之後的第一場：日期、對手、主／客。

**slate**（賽程列用）：把 `tip` 解析成 UTC 再轉布里斯本時間（固定 +10:00，無夏令時間），得出 `aest_date`、`aest_time`；並帶兩隊今季勝負（由逐場數據按 `game_id` 去重數每隊 W／L）。注意：ESPN 的 `tip` 帶美國東岸偏移，美國晚上的比賽在布里斯本是**第二日早上**。

**預設盤口**：`floor(l10_avg) + 0.5`；使用者輸入任何數都正規化為 `floor(x) + 0.5`，最小 0.5。

## 5. UI 規格

導航：頂部 breadcrumb「全部球隊 › 球隊 › 球員」，可點擊返回上層；URL hash 記錄當前層（#teams／#team／#player），重新打開時復原。每層只在打開時才計算自己的數據。

**賽程列**（每層頂部都顯示）：預設顯示今日（布里斯本日期），無賽事則跳到下一個有比賽的日子；‹ › 切換日子。每場一張卡：AEST 開波時間、客隊在上、主隊在下（跟 NBA.com 排法），每隊：小徽章＋簡稱＋今季勝負；橫向捲動；點隊名入該隊陣容頁。

**第 1 層—全部球隊**：東岸／西岸兩欄，每欄三個分區，分區內按戰績排（勝多→負少→縮寫）。每隊一列：徽章、全名、戰績、下一場（日期＋主客＋對手）。同頁下方放**球員篩選表**：選定項目、今季 ≥ 3 場的球員，欄：球員、球隊、位置、場數、今季平均、近 5 場、差距、上季平均、近 5 場 MIN、今季 MIN；可按任一欄排序、文字搜尋（球員／球隊），點列直入該球員分析頁。預設按差距降序。

**第 2 層—球隊陣容**：頂部大徽章＋全名＋分區＋戰績＋下一場。球員卡按近 5 場上場時間降序，每張卡：名字、位置＋場數＋近 5 場分鐘、四個數字（今季／近 5 場／差距／上季，差距 ≥ +1 綠、≤ −1 約）、「今晚盤口」佔位列（第二期填入）。若 `l5_min < szn_min − 4` 顯示橙色警告「上場時間跌緊」。頁內有項目選單（12 項）。點卡入球員分析頁。

**第 3 層—球員分析**：

1. **結論句**：「{球員} 近 10 場{項目}有 {x} 場大過 {盤口}（{x/10}），今季平均 {y}，上場時間近 5 場 {z} 分鐘。」
2. **控制列**：球員選單（按球隊分組 optgroup）、項目選單、盤口輸入（number 欄＋−／＋按鈕＋**橫向拉桿**（range，0.5 至該球員兩季最高值＋step 1）＋「按近 10 場平均」重設鈕）。換球員或項目時盤口重設為預設。
3. **六個過盤率方塊**：近 5 場、近 10 場、今季、上季、今季主場、今季客場；大數字為百分比（≥ 60% 綠、≤ 40% 紅），小字為「x / n 場過盤 · 平均 y」。
4. **逐場柱狀圖**：最近 10／20／40 場（可切換，預設 20），左舊右新；過盤實色、否則淡色；盤口虛線＋兩季分界直線；x 軸標日期與對手（密時隳格顯示避重疊）；hover tooltip：日期、對手、勝負、數值、分鐘。
5. **上場時間折線圖**：同一批場次，虛線為今季平均；tooltip 標正選／後備。
6. **下一場對手卡**：句子「對手 {opp} 今季每場畀 {pos} 位置球員攞 {v} {項目}，30 隊中排第 {rank} 多（比聯盟平均 {±d}）」＋該球員對這隊兩季往績表。
7. **各隊防守表**：選定項目的 30 隊每場容許（all／G／F／C）＋排名，可排序，下一場對手粗體。
8. **Odds 分析卡**：第一期為虛線框佔位。
9. **逐場紀錄表**：兩季全部場次，選定項目欄過盤綠／未過紅；組合項目欄（PRA 等）只在選了該組合時顯示。

通用：數字用 tabular-nums；表格超高時內捲＋表頭 sticky；所有元件在 \~400px 寬仍可用（圖表按容器寬重繪）。

## 6. Odds 模組（第二期）

數據源：The Odds API v4（需 API key，按次數計費）。流程：

1. `GET /v4/sports/basketball_nba/events` 取當日賽事 id。
2. 每場 `GET /v4/sports/basketball_nba/events/{id}/odds?regions=au&markets=player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists&oddsFormat=decimal`。澳洲莊家 bookmaker key：`sportsbet`、`tab`（另有 neds、ladbrokes\_au、unibet 可選）。
3. 每日開波前拉一次，存成快照：`fetched_at, game_id, bookmaker, player_name, market, line, over_price, under_price`；保留歷史快照即可畫盤口變動。

**球員名對應**：Odds API 用全名文字，與 ESPN 名字大致相同但有例外（重音符號、Jr.／III 後綴）。對應方法：去重音符號、去標點、小寫後比對；對不上的維護一張手動 alias 表；對不上就標示而不要猥配。

**計算**（decimal odds）：

```latex
implied_{over} = 1/odds_{over},\quad implied_{under} = 1/odds_{under}
```

```latex
p_{over}^{fair} = \frac{implied_{over}}{implied_{over} + implied_{under}}
```

兩邊隱含勝率相加超過 1 的部分是莊家抽水，按上式按比例去水。

估計勝率：在 hit\_grid 取該盤口（正規化為 .5）的過盤率，加權 `p_{est} = 0.5×l10 + 0.3×szn + 0.2×prev`（權重做成設定可調；某視窗無數據則按比例重分配）。

```latex
edge = p_{est} - p_{over}^{fair},\qquad EV_{over} = p_{est} \times odds_{over} - 1
```

**今晚排行頁**：所有有盤口的球員 × 市場，按 EV 降序，欄：球員、項目、盤口、最佳莊家與賠率、去水隱含勝率、估計勝率、edge、EV；點列入球員分析頁並帶入該盤口。球員分析頁的 Odds 卡顯示各莊家盤口與賠率並排。

顯示要求：注明盤口抓取時間；EV 只是歷史數據估計，頁面要有一句免責說明（未計傷病與上陣時間變動）。

## 7. 技術要求與效能教訓

Stack 不強制，建議：前端 React（Vite 或 Next.js）＋圖表用 d3 或 Recharts；ETL 用 Python；部署可用靜態網站＋GitHub Actions（每日重建）或輕量後端。數據量小（gamelogs 約 25,000 列，CSV 約 2.3 MB），前端全量載入可接受。

前一版實作踩過的坑，必須避免：

1. **hit\_grid 全聯盟預算約 84,000 列**，曾因每次重繪都重新取整張表＋重建索引，引致瀏覽器記憶體耗盡崩潰。解法二擇一：（a）只計當前球員的 grid（lazy，換球員才算，每次 <200 列）；（b）全量預算但索引（Map，key = `pid|stat|line`）只建一次並 memoize，所有組件共用同一份。建議（a）。
2. 重繪要去重：同一次更新內每份數據只取一次。
3. 排序用的 key 全部用文字型 id（pid、game\_id），避免浮點誤差。

其他：時區轉換寫死 UTC+10（昆士蘭無夏令時間）；介面文案用繁體中文（粵語用字，如「攞」「唷」「嗰」）；顏色語義：綠 = 好／過盤、紅 = 差／未過、橙 = 警告；深淡色主題均需支援。

## 8. 每日排程更新

每日布里斯本時間 03:30–04:00 執行（上游最後一次更新約 02:30 AEST）：

1. Shallow clone hoopR repo，跑 ETL 產生兩個 CSV。
2. 健康檢查，全過才換檔：標頭欄位正確；今季列數 ≥ 現有；最新 `date` 距今天（美國時間）不超過 2 日。
3. 更新失敗或數據無新增：保留舊檔，記錄原因，不要寫入。
4. 頁面永遠顯示「數據截至 {最新比賽日期}」；超過 48 小時未更新顯示過期標示。
5. 第二期加入：另一個每日任務在美國比賽開波前（約 09:00–11:00 AEST）拉當日盤口快照。

## 9. 驗收測試

用 2026-11-07（美國時間）版本的數據跑 ETL，以下數字必須完全一致，否則即是過濾或公式寫錯：

| 檢查 | 預期值 |
| --- | --- |
| nba\_gamelogs.csv 總列數 | 25,097 |
| 其中 2026-27 列數 | 3,122 |
| 球員數（唯一 pid） | 459 |
| Luka Doncic（pid 3945274）今季 pts 平均 | 40.1（9 場） |
| Luka 近 5 場 pts 平均 | 43.4 |
| Luka 上季 pts 平均 | 33.0（65 場） |
| Luka pts 盤口 35.5：近 10 場過盤 | 7／10 |
| Luka pts 盤口 35.5：近 5 場過盤 | 5／5 |
| Luka pts 盤口 35.5：上季過盤率 | 40% |
| 容許得分最多球隊（all 組 rank 1） | CHI，129.6／場（8 場） |
| 對 G 位容許得分最多 | MIA，69.3／場 |
| 全聯盟 hit\_grid 列數 | 83,825 |
| 各隊勝場總和 | 等於負場總和 |
| LAL 下一場（數據日之後） | 11-08 作客 DET |

行為測試：換球員／項目後盤口重設為該球員預設；盤口輸入 30 正規化為 30.5；某視窗無數據顯示「—」而非 NaN；在球員頁連續快速拉動盤口拉桿不卡不崩。

## 10. 交付清單

建議 repo 結構：

```markdown
nba-props/
  data/            # 三個 CSV（ETL 輸出＋nba_teams.csv）
  etl/build_data.py
  etl/fetch.sh     # sparse clone 指令
  web/             # 前端（三層 UI）
  odds/            # 第二期：盤口抓取與 EV 計算
  .github/workflows/daily.yml   # 每日 03:37 AEST = 17:37 UTC
  README.md
```

- [ ] ETL script 與每日排程（第 3、8 節），含健康檢查
- [ ] 三層 UI＋賽程列＋篩選表（第 5 節）
- [ ] 衍生計算模組，單元測試對踩第 9 節數字
- [ ] Odds 模組接口預留（第 6 節；無 API key 時頁面顯示「未接駁」）
- [ ] README：安裝、環境變數（`ODDS_API_KEY` 留空可跑）、本地啟動、部署

環境變數：`ODDS_API_KEY`（第二期）、`TZ=Australia/Brisbane`（排程用）。注意：此工具僅供個人分析使用，數據來源為公開數據庫，不重新發佈原始數據。
