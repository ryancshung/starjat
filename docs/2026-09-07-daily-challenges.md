# 每日挑戰、自訂獎勵與手機改善

## 家長與孩子如何操作

1. 家長在「任務」建立每日任務。星星可填 0；要加入挑戰的任務須持續保留，總完成次數不設上限。
2. 按「新增挑戰」，選任務及適用孩子，額外獎勵可選星星、自訂項目或兩者。自訂項目填名稱及選填說明。
3. 孩子逐項按「完成」。送出時按鈕鎖定並顯示送出中，接著顯示等待家長審核；可同時處理其他任務。
4. 家長在首頁審核。最後一項通過時，自動發放該組額外獎勵，不需另外申請。
5. 自訂獎勵顯示於「獎勵 → 挑戰獎勵」。家長實際提供後按「標記已兌現」；不扣星、不過期、不折算星星。
6. 手機底部固定「首頁、任務、獎勵、更多」。月報、家庭、紀錄、獎盃、零用錢及說明都在更多中。

例如 A／B／C 分別 5／0／5 星：基本共 10 星。額外設定 10 星時合計 20 星；若額外只設定「電動 30 分鐘」，仍是 10 星，加一筆待兌現項目。

## 日期與修改規則

- 依家庭時區的提交日期，每位孩子每項每日任務每天只領一次。退回後可於當天重送；昨日待審不會擋住今日的新任務。
- 核准日期可以晚於提交日期，依原日期、原任務星星、原挑戰條件發獎。
- 每日首次提交保存該孩子當日所有每日任務及適用挑戰。當天已開始任務後新建的挑戰，該孩子翌日才適用。
- 修改每日任務及挑戰設定、暫停挑戰，均從家庭時區翌日生效。管理設定顯示生效日期；今日進度仍顯示今日版本。
- 同一任務可加入多組挑戰。基本星星一天一次，各組額外獎勵各發一次。
- 挑戰中的任務要停用、改頻率或加總次數限制，須先從啟用中的挑戰移除，或先停用該挑戰。
- 不回溯發放上線前的挑戰獎勵。歷史任務與星星資料不改寫。舊待審申請沒有快照，維持原本審核方式，不補建挑戰進度。
- 月報按實際入帳／取得月份呈現基本任務星星、挑戰加碼星星及自訂項目，自訂項目不進入星星收支；項目旁保留任務歸屬日。

## 工程介面與一致性

Worker 與 Express 的任務路由共用 `backend/src/lib/task-service.ts`。所有任務設定、提交、審核及兌現，在資料庫交易中取得家庭資料列鎖。星星餘額用原子增量更新；同一交易完成基本入帳、加碼入帳及自訂項目建立。

| API | 行為 |
| --- | --- |
| `GET /api/tasks` | 回傳家庭時區 `localDate`、本人 `myStatus`；家長另有 `nextConfig` 供編輯翌日設定 |
| `POST /api/tasks/:id/complete` | 接受 `requestId`、選填 `note`，重試回傳同一 completion |
| `GET /api/tasks/challenges` | 今日進度與歷史已獲得獎勵；家長另得設定與可選孩子 |
| `POST /api/tasks/challenges` | 建立挑戰：title、taskIds、childIds、bonusStars、customTitle、customDescription、isActive |
| `PUT /api/tasks/challenges/:id` | 完整替換翌日生效版本，停用使用 isActive=false |
| `PUT /api/tasks/challenge-awards/:id/fulfill` | 僅同家庭家長／管理員可標記兌現；重試不改首次兌現時間 |

`TaskCompletion` 保存提交日期、星星／標題快照及唯一 activeKey；`TaskSubmissionRequest` 保存同一完成申請的每個請求識別碼，讓多分頁的不同請求即使已經核准，重試仍不重複提交。舊客戶端可省略 requestId，但完整的回應遺失重試保障需更新後前端。

`DailyTaskVersion`、`DailyChallengeVersion` 保存生效日版本，`TaskDaySnapshot` 按家庭／孩子／日期唯一；`ChallengeAward` 按挑戰／孩子／日期唯一。設定快照與歷史獎勵不隨原任務停用而刪除。

## 遷移與正式發布

**2026-09-07：正式資料庫遷移及 Worker 發布已完成，前端由 GitHub main 發布至 [StarJar](https://starjat.vercel.app)。**

發布程序：

1. 備份資料庫並暫停舊版的任務寫入，避免新舊後端同時審核。
2. 執行 `backend/prisma/migrations/20260907_daily_challenges/preflight.sql`。第一份結果若有重複待審申請，列出 completionIds 交由家長確認如何處理，不自動刪除或改寫。歷史同日重複核准只報告，不追回星星。
3. 確認既有遷移歷史已正確建檔，再套用 `migration.sql`。它只有新增資料結構，並在偵測到重複待審時停止。不得用 `db push` 取代此遷移，因為它不執行 preflight guard。
4. 先發布新後端、再發布前端，確認健康檢查、孩子提交、家長核准、加碼與月報後恢復寫入。
5. 如需回復版本，先停用任務寫入；保留新增表與歷史，不執行刪表回滾。不可讓舊後端繼續處理新增格式的申請，以免繞過每日與加碼保障。

## 測試

```powershell
cd D:\Reward\backend
npm test
npm run build
npm run worker:typecheck
cd D:\Reward\frontend
npm test
npm run build
```

後端測試會自建記憶體 PGlite PostgreSQL、執行舊版 schema 與新增遷移，再用真實 Prisma 查詢驗證計分、交易回滾、唯一限制、跨日規則、角色權限與遷移 guard；完全不使用 `.env` 的資料庫。PGlite 使用單一實體連線；另已在正式 Worker／Neon 用獨立測試家庭驗證 4 次並行提交、3 項並行核准與重複兌現，結果符合預期。

發布驗證使用 `backend/scripts/release-smoke.cjs`，測試帳戶只屬於臨時家庭，驗證完成後執行 `node scripts/release-smoke.cjs cleanup` 清除。備份與短期測試憑證放在 Git 忽略的 `backend/.release/`，不得納入版本控制。

前端 Playwright 使用電腦已安裝的 Chrome，攔截 API 為測試資料，涵蓋快速連點、回應遺失、重新整理、設定自訂獎勵、兌現、鍵盤導覽，以及 360／390／768px 月報與列印樣式。這是 Chrome 手機尺寸測試，尚未在實體 iPhone／Safari 驗證。

測試截圖與失敗追蹤寫入忽略版本控制的 `frontend/test-results/`。
