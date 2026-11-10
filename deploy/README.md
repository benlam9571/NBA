# Vercel + Supabase 新專案部署

部署架構：**Vercel 靜態前端 → Supabase Auth 登入 → 私有 Storage 快照**。

現有 7 MB 左右的球員快照由瀏覽器直接經 Supabase 權限檢查後下載，不經 Vercel Function 的回應大小限制。使用者名單存在 Postgres 的 `public.nba_app_members`；大量逐場資料仍沿用既有 JSON／CSV，不用把整張 hit grid 寫進資料庫。

此文件提供可實際操作的新專案設定。程式碼及本機測試完成不代表雲端帳戶、專案、SQL 或部署已建立。

## 1. 建立 Supabase 專案

在 https://supabase.com/dashboard 建立一個專供此網站使用的專案。選擇靠近使用者的區域，例如 Sydney（若帳戶方案提供）；選擇符合自己需求的方案。資料庫密碼由你安全保管，不要放入 GitHub、前端環境變數或聊天。

在 SQL Editor 執行一次：

`supabase/migrations/202611100001_private_snapshots.sql`

它建立：

- `nba-props-private` 私有 Storage bucket（每個 JSON 最多 50 MiB）。
- `public.nba_app_members` 使用者白名單；主鍵支援 RLS 查詢。
- 只有白名單中的登入帳戶可讀資料。未登入、非成員或瀏覽器寫入均被阻擋。
- 即使其他應用有較寬鬆的 Storage policies，此 bucket 的 restrictive policies 仍會限制讀寫。

SQL 不會刪除現有資料；若同名物件已存在，整筆 migration 會失敗，請先檢查而非重複執行。

## 2. 建立自己的登入帳戶

在 Supabase Authentication 的 Users 管理頁面建立自己的 email / password 帳戶（確認 email 狀態），然後在 SQL Editor 將其 User UID 加入白名單：

```sql
insert into public.nba_app_members(user_id)
values ('在此填入你剛建立的 User UID')
on conflict (user_id) do nothing;
```

UID 是 UUID，不是 email。這個動作只授予使用此私人網站的權限，不提供上傳或管理其他使用者的權限。

在 Authentication 的設定中停用新使用者自行註冊；網站本身只有登入表單。此版本使用密碼登入，不依賴 email magic link、OAuth 或 URL token callback。

## 3. 上傳第一份資料

在執行 Python 的環境安全設定：

| 變數 | 用途 | 放置位置 |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase 專案 HTTPS origin | 本機／GitHub Actions |
| `SUPABASE_SERVICE_ROLE_KEY` | 後端上傳憑證（service-role JWT） | 安全環境／GitHub repository Secrets |
| `ODDS_API_KEY` | 可選，抓取賠率 | 安全環境／GitHub repository Secrets |

`SUPABASE_SERVICE_ROLE_KEY` 永遠不加 `VITE_` 前綴、不放 Vercel 前端、不提交檔案。不要把密鑰直接放進 shell 命令、參數或聊天。可在部署服務的安全 Secret 表單輸入。

從專案根目錄執行：

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
PYTHON=.venv/bin/python bash etl/fetch.sh
# 已設定 Odds key 才執行；沒有 key 可跳過此步
.venv/bin/python -m odds.fetch
.venv/bin/python -m deploy.publish_supabase
```

上傳器驗證數據日期與格式，拒絕測試盤口。它以內容 hash 建立不可變版本，先上傳球員數據、再上傳盤口，最後才更新 `latest.json`。中途失敗不切換 manifest，使用者仍讀上一份完整資料。相同內容會重用既有物件並核對 bytes，不重複儲存。

若尚無 odds 檔案，上傳器會建立未接駁的盤口快照。歷史版本目前不自動刪除；請按 Storage 容量管理舊版本，保留 `latest.json` 指向的兩份物件。

## 4. 建立 Vercel 專案

在 https://vercel.com/new 匯入 **既有 GitHub repository `benlam9571/NBA`**。

設定：

- **Root Directory：留空／repository root**（不要填 `web`）。
- Framework：Vite（根目錄 `vercel.json` 已設定）。
- Install：`npm --prefix web ci`
- Build：`npm --prefix web run build`
- Output：`web/dist`
- Node.js：24.x。

在 Vercel Project Settings 的 Environment Variables 設定這三個 **前端公開值**，Production / Preview 要分別勾選：

```text
VITE_DATA_MODE=supabase
VITE_SUPABASE_URL=https://你的專案ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=Supabase 的 publishable key（或舊版 anon key）
```

URL 與 publishable／anon key 可出現在瀏覽器；資料保護由 Auth + RLS 負責。不要把 service-role／secret key 或 Odds API key 填進以上欄位。Build 會拒絕 service-role key 及常見錯誤的 `VITE_*` secret 設定，雲端 build 亦完全不拷貝本機 `data/`。

Deploy 完成後，以自己的帳戶登入。Supabase Authentication 的 Site URL 可設為該 production 網址；本版密碼登入不需要 wildcard redirect URL。

導航使用 hash，例如 `/#player/3945274`，不需要 SPA rewrite。若之後新增子路徑部署，請同步調整 Vite base。

## 5. 接上每日更新

在 GitHub repository → Settings → Secrets and variables → Actions 加入：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ODDS_API_KEY`（可選）

既有 `daily.yml` 於每日 03:37 AEST 更新 box score；`odds.yml` 於每日 09:07 AEST 抓取盤口。兩者測試及 build 成功後都會執行私有 Storage 上傳；缺少全部 Supabase 設定時跳過，只有填一半則明確報錯。

每天只更換 Storage manifest，**不必重新部署 Vercel**。已開啟的頁面重新整理才讀最新版本。Vercel 只需在程式碼變更時重新部署。

若受限雲端環境執行上傳／抓取，需允許專案 `你的ref.supabase.co` 及 `api.the-odds-api.com`（用 Odds 功能時）的 HTTPS 存取。

## 6. 測試與限制

```bash
.venv/bin/pytest -q
cd web
npm ci
npm test
npm run build
npm run test:e2e
npm run test:cloud
cd ..
bash tests/run_rls.sh
```

`test:cloud` 以公開的測試 key 和攔截 API 回應驗證登入、未授權、manifest、登出及手機版；不會對真實 Supabase 專案發出請求。`run_rls.sh` 需 Docker，建立一次性 PostgreSQL 17 容器及最小 auth/storage schema，實際執行 migration 和 RLS 測試，不連接現有資料庫。這些驗證不等於真實 Supabase Storage API 或已部署 Vercel 的驗證。

`.vercelignore` 排除本機數據、快取、依賴及所有真實 `.env`；Git 同樣忽略這些檔案。前端僅打包程式碼與公開 Supabase 設定。
