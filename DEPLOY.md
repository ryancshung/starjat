# StarJar 部署指南（Vercel + Railway + Supabase）

## 總覽

| 服務 | 用途 | 網址 |
|------|------|------|
| Supabase | PostgreSQL 資料庫 | supabase.com |
| Railway | 後端 Express API | railway.app |
| Vercel | 前端 React | vercel.com |
| GitHub | 程式碼倉庫 | github.com |

---

## 第一步：GitHub

在本機專案根目錄 `D:\Vibecoding\Reward`：

```powershell
cd D:\Vibecoding\Reward

# 若還沒有 git
git init
git add .
git commit -m "StarJar ready for deploy"

# 到 GitHub 網站新建空 repo（不要勾 README）
# 然後：
git remote add origin https://github.com/你的帳號/starjar.git
git branch -M main
git push -u origin main
```

確認 `.env` 沒有被推上去（已在 `.gitignore`）。

---

## 第二步：Supabase（資料庫）

1. 開啟 https://supabase.com → 註冊 / 登入
2. **New Project** → 選地區、設資料庫密碼（請記下來）
3. 專案建立完成後：
   - 左側 **Project Settings**（齒輪）
   - **Database**
   - 找到 **Connection string** → 選 **URI**
   - 複製，並把 `[YOUR-PASSWORD]` 換成你的資料庫密碼  
   - 範例：
     ```
     postgresql://postgres.xxxxx:你的密碼@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
     ```
   - 也可使用 **Session mode** 的 5432 port 連線字串

4. （可選）本機先測連線：

```powershell
cd D:\Vibecoding\Reward\backend
# 暫時把 .env 的 DATABASE_URL 改成 Supabase 字串
npx prisma db push
```

成功會在 Supabase Table Editor 看到 `User`、`Family` 等表。

---

## 第三步：Railway（後端）

1. 開啟 https://railway.app → 用 GitHub 登入
2. **New Project** → **Deploy from GitHub repo** → 選 `starjar`
3. 若 Railway 偵測到整個 monorepo：
   - 進入服務 → **Settings**
   - **Root Directory** 設為 `backend`
4. **Variables** 新增：

| 變數 | 值 |
|------|-----|
| `DATABASE_URL` | Supabase 的連線字串 |
| `JWT_SECRET` | 一串很長的隨機字元（可用密碼產生器） |
| `JWT_EXPIRES_IN` | `7d` |
| `CORS_ORIGIN` | 先填 `http://localhost:5173`（等 Vercel 好了再改） |
| `PORT` | `3001`（Railway 也可能自動注入 `PORT`） |

5. **Settings → Deploy**：
   - Build Command：`npm run build`
   - Start Command：`npm start`
6. 部署完成後，到 **Settings → Networking → Generate Domain**  
   得到後端網址，例如：`https://starjar-api-production.up.railway.app`
7. 瀏覽器開啟：`https://你的後端網域/api/health`  
   應看到：`{"status":"ok","name":"StarJar API"}`

---

## 第四步：Vercel（前端）

1. 開啟 https://vercel.com → 用 GitHub 登入
2. **Add New Project** → Import `starjar` repo
3. 設定：
   - **Root Directory**：`frontend`（點 Edit 選擇）
   - Framework：Vite
   - Build Command：`npm run build`
   - Output Directory：`dist`
4. **Environment Variables**：

| 變數 | 值 |
|------|-----|
| `VITE_API_URL` | `https://你的後端.up.railway.app`（不要結尾斜線） |

5. Deploy
6. 得到前端網址，例如：`https://starjar.vercel.app`

---

## 第五步：把前後端串起來

1. 回到 **Railway** → Variables  
   把 `CORS_ORIGIN` 改成：

   ```
   https://starjar.vercel.app,http://localhost:5173
   ```

   （改成你的實際 Vercel 網域）

2. Railway 會自動重新部署
3. 開啟前端網址，註冊帳號測試

---

## 本機開發注意

部署後若本機還要開發：

- **本機繼續用 SQLite**：把 `schema.prisma` 的 `provider` 改回 `"sqlite"`，`DATABASE_URL="file:./dev.db"`（僅本機）
- 或 **本機也連 Supabase**：共用同一組 `DATABASE_URL`（注意不要清到正式資料）

目前 repo 已改為 `postgresql`，本機若要用 Postgres：

```powershell
cd backend
# .env 填 Supabase DATABASE_URL
npm install
npx prisma generate
npx prisma db push
npm run dev
```

---

## 檢查清單

- [ ] 程式碼已 push 到 GitHub
- [ ] Supabase 專案建立，拿到 `DATABASE_URL`
- [ ] Railway 部署成功，`/api/health` 回 ok
- [ ] Vercel 部署成功，有設定 `VITE_API_URL`
- [ ] Railway `CORS_ORIGIN` 含 Vercel 網域
- [ ] 用正式網址完成註冊 → 建立家庭 → 邀請孩子

---

## 常見問題

**1. Railway 建置失敗：找不到 prisma**  
→ 確認 Root Directory 是 `backend`，且 `package.json` 的 dependencies 有 `prisma`。

**2. 前端 Failed to fetch**  
→ 檢查 `VITE_API_URL` 是否正確、Railway 是否在跑、`CORS_ORIGIN` 是否包含前端網域。

**3. Prisma 連線失敗**  
→ Supabase 連線字串密碼若有特殊字元需 URL encode；可改用 Connection pooling 的 6543 port。

**4. 資料表是空的**  
→ 在 Railway 的 start 指令已含 `prisma db push`；也可在本機對正式 `DATABASE_URL` 執行一次 `npx prisma db push`。
