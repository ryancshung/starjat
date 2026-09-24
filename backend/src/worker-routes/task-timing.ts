import { safeAuthError } from './auth-timing';

export function taskRouteName(path: string) {
  const first = path.split('/').filter(Boolean)[0];
  if (!first) return 'list';
  if (['challenges', 'challenge-awards', 'groups', 'pending', 'order', 'completions'].includes(first)) return first;
  return 'task';
}

export function createTaskTiming(method: string, path: string) {
  const requestId = crypto.randomUUID();
  const route = taskRouteName(path);
  const startedAt = performance.now();
  let previousAt = startedAt;

  const mark = (
    stage: 'T0_received' | 'T1_db_start' | 'T2_db_complete' | 'T3_response_ready',
    details: Record<string, string | number | boolean> = {}
  ) => {
    const now = performance.now();
    console.log(JSON.stringify({
      event: 'task_timing',
      method,
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
  return { requestId, route, mark };
}

export const safeTaskError = safeAuthError;
