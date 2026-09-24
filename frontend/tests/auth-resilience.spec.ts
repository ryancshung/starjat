import { expect, test } from '@playwright/test';

test('login retries one transient network failure and then succeeds', async ({ page }) => {
  let loginAttempts = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/login') {
      loginAttempts += 1;
      if (loginAttempts === 1) return route.abort('failed');
      return route.fulfill({ json: { token: 'permanent-token', user: { id: 'parent', email: 'parent@test.invalid', name: '家長', role: 'PARENT', points: 0 } } });
    }
    if (path === '/api/families/me') return route.fulfill({ json: { family: null } });
    return route.fulfill({ json: { completions: [], redemptions: [], requests: [] } });
  });

  await page.goto('/login');
  await page.getByLabel('Email').fill('parent@test.invalid');
  await page.getByLabel('密碼').fill('correct-password');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page).toHaveURL(/\/app/);
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
