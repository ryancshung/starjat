import { expect, test } from '@playwright/test';

test('login retries one transient network failure and then succeeds', async ({ page }) => {
  let loginAttempts = 0;
  const user = { id: 'parent', email: 'parent@test.invalid', name: '家長', role: 'PARENT', points: 0 } as const;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/login') {
      loginAttempts += 1;
      if (loginAttempts === 1) return route.abort('failed');
      return route.fulfill({ json: { token: 'permanent-token', user } });
    }
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { ...user, memberships: [] } } });
    if (path === '/api/families/me') return route.fulfill({ json: { family: null } });
    return route.fulfill({ json: { completions: [], redemptions: [], requests: [] } });
  });

  await page.goto('/login');
  await page.getByLabel('Email').fill('parent@test.invalid');
  await page.getByLabel('密碼').fill('correct-password');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 10000 });
  expect(loginAttempts).toBe(2);
});

test('login does not retry a definitive 401 response', async ({ page }) => {
  let loginAttempts = 0;
  await page.route('**/api/auth/login', async (route) => {
    loginAttempts += 1;
    await route.fulfill({ status: 401, json: { error: 'Email 或密碼錯誤' } });
  });

  await page.goto('/login');
  await page.getByLabel('Email').fill('parent@test.invalid');
  await page.getByLabel('密碼').fill('wrong-password');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Email 或密碼錯誤');
  expect(loginAttempts).toBe(1);
});

test('auth timeout retries once, shows Chinese guidance, and never leaks AbortError', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/test-timeout', async (route) => {
    attempts += 1;
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({ json: { ok: true } }).catch(() => undefined);
  });

  await page.goto('/login');
  const message = await page.evaluate(async () => {
    const { request } = await import('/src/lib/api.ts');
    try {
      await request('/api/test-timeout', {}, { timeoutMs: 25, retryTransientOnce: true });
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });

  expect(attempts).toBe(2);
  expect(message).toBe('伺服器回應時間較長，請稍候後再試。');
  expect(message).not.toContain('aborted');
});

test('me retries exactly once and leaves cached auth state intact', async ({ page }) => {
  const cached = { id: 'parent', email: 'parent@test.invalid', name: '離線家長', role: 'PARENT', points: 0 };
  let meAttempts = 0;
  await page.route('**/api/auth/me', async (route) => {
    meAttempts += 1;
    await route.abort('failed');
  });

  await page.goto('/login');
  await page.evaluate(async (user) => {
    localStorage.setItem('token', 'permanent-token');
    localStorage.setItem('auth-user', JSON.stringify(user));
    const { api } = await import('/src/lib/api.ts');
    await api.me().catch(() => undefined);
  }, cached);
  expect(meAttempts).toBe(2);
  expect(await page.evaluate(() => ({ token: localStorage.getItem('token'), user: JSON.parse(localStorage.getItem('auth-user') || 'null') }))).toEqual({ token: 'permanent-token', user: cached });
});

test('task reads retry one temporary server failure and then return data', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/tasks', async (route) => {
    attempts += 1;
    if (attempts === 1) return route.fulfill({ status: 500, json: { error: '暫時無法連線' } });
    return route.fulfill({ json: { localDate: '2026-09-24', tasks: [] } });
  });

  await page.goto('/login');
  const result = await page.evaluate(async () => {
    localStorage.setItem('token', 'permanent-token');
    const { api } = await import('/src/lib/api.ts');
    return api.getTasks();
  });

  expect(attempts).toBe(2);
  expect(result).toEqual({ localDate: '2026-09-24', tasks: [] });
});

test('task page keeps loaded data and offers retry when a refresh fails', async ({ page }) => {
  const user = { id: 'child', email: 'child@test.invalid', name: '小星', role: 'CHILD', points: 0 } as const;
  let taskReads = 0;
  await page.addInitScript((cachedUser) => {
    localStorage.setItem('token', 'permanent-token');
    localStorage.setItem('auth-user', JSON.stringify(cachedUser));
  }, user);
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { ...user, memberships: [] } } });
    if (path === '/api/families/me') return route.fulfill({ json: { family: { id: 'family', name: '測試家庭', members: [] } } });
    if (path === '/api/tasks' && route.request().method() === 'GET') {
      taskReads += 1;
      if (taskReads > 1) return route.fulfill({ status: 500, json: { error: '暫時無法連線' } });
      return route.fulfill({ json: { localDate: '2026-09-24', tasks: [{ id: 'task', title: '閱讀 20 分鐘', points: 5, isRecurring: true, recurringType: 'daily', keepAfterCompletion: true, maxCompletions: null, completions: [], myStatus: 'READY' }] } });
    }
    if (path === '/api/tasks/task/complete') return route.fulfill({ json: { completion: { id: 'completion', status: 'PENDING' } } });
    if (path === '/api/tasks/challenges') return route.fulfill({ json: { localDate: '2026-09-24', settings: [], children: [], progress: [], awards: [] } });
    if (path === '/api/tasks/groups') return route.fulfill({ json: { groups: [] } });
    return route.fulfill({ json: {} });
  });

  await page.goto('/app/tasks');
  await expect(page.getByText('閱讀 20 分鐘')).toBeVisible();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByText('任務更新失敗，目前顯示上次載入的資料。')).toBeVisible();
  await expect(page.getByText('閱讀 20 分鐘')).toBeVisible();
  await expect(page.getByRole('button', { name: '重試', exact: true }).first()).toBeVisible();
  expect(taskReads).toBe(3);
});
