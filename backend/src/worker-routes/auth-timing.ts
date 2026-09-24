export type AuthTimingRoute = 'login' | 'me';

export function createAuthTiming(route: AuthTimingRoute) {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  let previousAt = startedAt;

  const mark = (stage: 'T0_received' | 'T1_db_connect_start' | 'T2_db_ready' | 'T3_sql_complete' | 'T4_response_ready', details: Record<string, string | number | boolean> = {}) => {
    const now = performance.now();
    console.log(JSON.stringify({
      event: 'auth_timing',
      route,
      requestId,
      stage,
      stepMs: Math.round(now - previousAt),
      totalMs: Math.round(now - startedAt),
      ...details,
    }));
    previousAt = now;
  };

  mark('T0_received');
  return { requestId, mark };
}

export function safeAuthError(error: unknown) {
  const value = error as { name?: unknown; code?: unknown };
  return {
    errorName: typeof value?.name === 'string' ? value.name : 'UnknownError',
    ...(typeof value?.code === 'string' ? { errorCode: value.code } : {}),
  };
}
