# StarJar - 家庭獎勵系統

家庭友善的孩子獎勵系統，支援任務、限定日期獎勵、安全扣星、零用錢兌換、每月回顧及遊戲式獎盃。

## 文件與正式環境

- [正式網站](https://starjat.vercel.app)
- [使用說明書](docs/starjar-user-guide.html)
- [2026-08-31 升級清單](docs/2026-08-31-upgrade-notes.md)
- [部署指南](DEPLOY.md)

## 技術棧

| 層級 | 技術 |
|------|------|
| Frontend | React 18 + TypeScript + Vite + TailwindCSS |
| Backend | Cloudflare Workers + Hono；Node.js + Express 備援 |
| ORM | Prisma |
| Database | Neon PostgreSQL |
| Auth | JWT + bcrypt |
| 正式部署 | Vercel（前端）+ Cloudflare Workers（API）+ Neon（資料庫） |

## 專案結構

```
Reward/
├── backend/                 # Express API
│   ├── prisma/
│   │   └── schema.prisma    # 資料庫 schema
│   ├── src/
│   │   ├── middleware/      # 認證、授權、錯誤處理
│   │   ├── routes/          # API 路由
│   │   ├── lib/             # 工具函式
│   │   └── index.ts         # 入口
│   ├── package.json
│   └── tsconfig.json
├── frontend/                # React 前端
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── lib/
│   │   ├── hooks/
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts
└── README.md
```

## 快速開始

### 1. 後端

```bash
cd backend
npm install

# 設定環境變數
cp .env.example .env
# 編輯 .env，填入 DATABASE_URL 與 JWT_SECRET

# 全新本機資料庫可用 db push 建立；既有正式環境使用 migration
npx prisma generate
npx prisma db push

# 啟動開發伺服器（預設 http://localhost:3001）
npm run dev
```

### 2. 前端

```bash
cd frontend
npm install

# 設定 API 位址（可選）
# 在 .env 中設定 VITE_API_URL=http://localhost:3001

# 啟動開發伺服器（預設 http://localhost:5173）
npm run dev
```

### 3. 測試帳號流程

1. 開啟 http://localhost:5173
2. 註冊一位**家長**帳號
3. 建立家庭，取得邀請碼
4. 另開視窗註冊**孩子**帳號，使用邀請碼加入家庭
5. 家長發積分、建立任務與獎勵
6. 孩子完成任務、兌換獎勵

## 核心功能

- **三角色**：Admin / Parent / Child
- **家庭管理**：建立家庭、邀請碼加入、成員管理
- **星星系統**：發放、安全扣星、關聯補回、保留與交易歷史
- **任務系統**：建立任務、完成、家長審核、可重複任務
- **獎勵系統**：限定日期／時段、折扣、星星保留、兌換審核與撤回
- **零用錢**：家庭兌換比例、孩子月上限、申請與審核
- **每月回顧**：家庭總覽、孩子個別報表及 A4 列印
- **獎盃系統**：內建與自訂獎盃、進度、回溯解鎖及手動頒發
- **定期派發**：每天、每週或每月依家庭時區發放星星
- **Admin**：查看使用者與家庭

## API 概覽

| Method | Endpoint | 說明 |
|--------|----------|------|
| POST | /api/auth/register | 註冊 |
| POST | /api/auth/login | 登入 |
| GET | /api/auth/me | 目前使用者 |
| POST | /api/families | 建立家庭 |
| POST | /api/families/join | 用邀請碼加入 |
| GET | /api/families/me | 我的家庭 |
| POST | /api/points/award | 發放積分 |
| GET | /api/points/history | 積分歷史 |
| POST | /api/points/deduct | 安全扣星 |
| POST | /api/points/transactions/:id/reverse | 補回誤扣星星 |
| GET/POST | /api/tasks | 任務 CRUD |
| POST | /api/tasks/:id/complete | 標記完成 |
| PUT | /api/tasks/completions/:id | 審核完成 |
| GET/POST | /api/rewards | 獎勵 CRUD |
| POST | /api/rewards/:id/redeem | 兌換 |
| PUT | /api/rewards/redemptions/:id | 審核兌換 |
| GET/POST | /api/allowance | 零用錢申請與紀錄 |
| GET | /api/reports/monthly | 每月回顧 |
| GET/POST | /api/trophies | 獎盃列表與自訂獎盃 |
| GET | /api/admin/users | 使用者列表（Admin） |
| GET | /api/admin/families | 家庭列表（Admin） |

## 環境變數

### Backend `.env`

```env
DATABASE_URL="postgresql://user:password@host:5432/starjar?sslmode=require"

JWT_SECRET="your-super-secret-jwt-key-change-me"
JWT_EXPIRES_IN="7d"
PORT=3001
CORS_ORIGIN="http://localhost:5173"
```

### Frontend `.env`

```env
VITE_API_URL=http://localhost:3001
```

## 資料庫 Schema 重點

### 2026-09-07 每日挑戰

- 任務可為 0 星；每日任務每位孩子每天只領一次，退回可重送。
- 每日挑戰支援星星、自訂獎勵或兩者；全數核准後自動發放，自訂獎勵由家長標記兌現。
- 挑戰與每日任務修改翌日生效，提交日期依家庭時區保存；跨日審核保留原獎勵。
- 手機使用「更多 → 月報」，家長看家庭／孩子，孩子只看自己。
- 新 API：`GET/POST /api/tasks/challenges`、`PUT /api/tasks/challenges/:id`、`PUT /api/tasks/challenge-awards/:id/fulfill`。
- 遷移、相容性與測試詳見 [每日挑戰交付說明](docs/2026-09-07-daily-challenges.md)。正式資料庫及 Worker 已於 2026-09-07 更新，前端由 main 分支發布至 Vercel。

- `User`：角色（ADMIN / PARENT / CHILD）、積分餘額
- `Family`：家庭、邀請碼、時區與零用錢比例
- `FamilyMember`：成員、扣星權限與孩子零用錢上限
- `PointTransaction`：不可刪除的星星異動與關聯補回紀錄
- `Task` / `TaskCompletion`：任務與完成審核
- `Reward` / `RewardAvailabilityDate` / `RewardRedemption`：限定獎勵與兌換審核
- `AllowanceRedemption`：零用錢兌換申請
- `ScheduledAward`：依家庭時區執行的定期派發
- `TrophyDefinition` / `UserTrophy`：獎盃規則與解鎖紀錄

## 授權說明

本專案為示範用途，請在正式上線前加強安全性（HTTPS、更嚴格的驗證、Rate Limit 等）。
