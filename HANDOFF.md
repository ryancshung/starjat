# StarJar 交接紀錄

更新日期：2026-08-22

## 目標與決策

目標是將 StarJar 以低流量、長期零成本的方式部署：

| 層級 | 決定 |
| --- | --- |
| 前端 | Vercel Hobby |
| API | Cloudflare Workers + Hono |
| 資料庫 | Neon PostgreSQL Free |

選擇 Neon 的原因是它保留 PostgreSQL 與 Prisma 相容性，閒置時會自動休眠並在下一次查詢時自動喚醒；不需像 Supabase Free 一樣在長期閒置後手動恢復專案。

## 已完成

### 原有 Express 後端修正

- 修復 `backend/src/routes/auth.ts` 中註冊路由的 TypeScript 語法錯誤，並補回成功註冊回應。
- 修正 `backend/src/index.ts` 的 CORS 白名單：未知網域改為拒絕，不再全部放行。
- 已驗證 `cd backend && npm run build` 可通過。

### Cloudflare Worker 版本

已建立 Worker 入口與設定：

- `backend/wrangler.jsonc`
- `backend/src/worker.ts`
- `backend/tsconfig.worker.json`
- `backend/.dev.vars.example`

採用 Hono 與 Neon 的 Prisma driver adapter。Neon 連線與 JWT 等機密值從 Cloudflare binding 讀取，不放入程式碼。

下列 API 已全部搬至 `backend/src/worker-routes/`：

- `auth.ts`：註冊、登入、目前使用者
- `families.ts`：建立家庭、加入、讀取家庭、移除成員
- `points.ts`：發放積分、歷史、餘額
- `tasks.ts`：任務列表、建立、完成申請、審核、待審核列表
- `rewards.ts`：獎勵列表、建立、兌換申請、審核、待審核列表
- `admin.ts`：使用者／家庭列表、刪除使用者

任務與獎勵核准時的積分餘額與交易紀錄維持在 Prisma transaction 內。

## 已驗證

在 `backend` 目錄執行：

```powershell
npm run worker:typecheck
npx wrangler deploy --dry-run
npm run build
```

三項皆已通過。首次連續執行 `prisma generate` 曾遇到 Windows 檔案暫時鎖定；單獨重試 `npm run build` 即成功。

## 尚未完成：部署前作業

以下需要由擁有 Neon、Cloudflare、Vercel 帳號的人執行：

1. 建立 Neon 專案與 PostgreSQL 資料庫，取得**pooled** 連線字串。
2. 在本機將連線字串放入 `backend/.env`，執行一次資料庫初始化：

   ```powershell
   cd backend
   npx prisma db push
   ```

   正式上線前建議建立第一份 Prisma migration，並以 `prisma migrate deploy` 取代長期使用 `db push`。

3. 登入 Cloudflare，設定 Worker secrets：

   ```powershell
   cd backend
   npx wrangler secret put DATABASE_URL
   npx wrangler secret put JWT_SECRET
   npx wrangler secret put JWT_EXPIRES_IN
   npx wrangler secret put CORS_ORIGIN
   npm run worker:deploy
   ```

   `CORS_ORIGIN` 應為 Vercel 正式網域與本機網址，以逗號分隔，例如：
   `https://your-app.vercel.app,http://localhost:5173`

4. 在 Vercel 專案設定前端環境變數 `VITE_API_URL` 為 Worker 網址（不加結尾斜線），重新部署前端。
5. 用正式網址完整測試：註冊家長、建立家庭、以邀請碼註冊孩子、發積分、任務審核、獎勵兌換。

## 重要注意事項

- 目前 Express 路由仍保留在 `backend/src/routes/`，以便回退；Cloudflare 實際使用的是 `backend/src/worker.ts` 與 `worker-routes/`。
- 不要將 `.env` 或 `.dev.vars` 提交。範本檔 `.dev.vars.example` 可安全提交。
- `frontend` 尚未切換 API 網址；在取得 Worker 網址前不要設定正式 `VITE_API_URL`。
- `package.json` 目前使用 Prisma 6.16 與 `@prisma/adapter-neon` 7.9。型別檢查與打包已通過，但接手者應在實際 Neon 整合測試前評估將 adapter 與 Prisma Client 對齊同一個主要版本，避免未來相容性風險。
- `npm install` 顯示 4 個 high-severity audit 項目；尚未執行自動修復，避免未經評估的破壞性升級。

## 目前未提交的變更

主要變更位於 `backend/package.json`、`backend/package-lock.json`、既有 Express 修正檔案，以及新增的 Worker 檔案。尚未建立 commit。
