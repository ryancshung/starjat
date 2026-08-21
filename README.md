# StarJar - Kids Reward System

家庭友善的孩子獎勵系統，支援家長發放積分、建立任務與獎勵，孩子可完成任務並兌換獎勵。

## 技術棧

| 層級 | 技術 |
|------|------|
| Frontend | React 18 + TypeScript + Vite + TailwindCSS |
| Backend | Node.js + Express + TypeScript |
| ORM | Prisma |
| Database | PostgreSQL（可用 SQLite 本地開發） |
| Auth | JWT + bcrypt |
| 部署建議 | Vercel（前端）+ Railway（後端） |

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

# 初始化資料庫
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
- **積分系統**：發放、消費、調整、交易歷史
- **任務系統**：建立任務、完成、家長審核、可重複任務
- **獎勵系統**：建立獎勵、兌換、審核
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
| GET/POST | /api/tasks | 任務 CRUD |
| POST | /api/tasks/:id/complete | 標記完成 |
| PUT | /api/tasks/completions/:id | 審核完成 |
| GET/POST | /api/rewards | 獎勵 CRUD |
| POST | /api/rewards/:id/redeem | 兌換 |
| PUT | /api/rewards/redemptions/:id | 審核兌換 |
| GET | /api/admin/users | 使用者列表（Admin） |
| GET | /api/admin/families | 家庭列表（Admin） |

## 環境變數

### Backend `.env`

```env
DATABASE_URL="postgresql://user:password@localhost:5432/starjar"
# 本地開發可用 SQLite：
# DATABASE_URL="file:./dev.db"

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

- `User`：角色（ADMIN / PARENT / CHILD）、積分餘額
- `Family`：家庭 + 邀請碼
- `FamilyMember`：成員關聯
- `PointTransaction`：積分異動紀錄
- `Task` / `TaskCompletion`：任務與完成審核
- `Reward` / `RewardRedemption`：獎勵與兌換審核

## 授權說明

本專案為示範用途，請在正式上線前加強安全性（HTTPS、更嚴格的驗證、Rate Limit 等）。
