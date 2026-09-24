import { Hono } from 'hono';
import { ZodError } from 'zod';
import { createPrisma, disconnectPrisma } from '../lib/worker-prisma';
import { taskRequest, TaskError } from '../lib/task-service';
import { authenticate, type WorkerRouteEnv } from './shared';
import { createTaskTiming, safeTaskError } from './task-timing';

export function createTaskRoutes(getDb = createPrisma) {
const tasks = new Hono<WorkerRouteEnv>();
tasks.use('*', authenticate);
tasks.all('*', async c => {
  const db = getDb(c.env.DATABASE_URL);
  const path = new URL(c.req.url).pathname.replace(/^\/api\/tasks/, '');
  const timing = createTaskTiming(c.req.method, path);
  try {
    const body = ['POST','PUT'].includes(c.req.method) ? await c.req.json() : {};
    timing.mark('T1_db_start');
    const result = await taskRequest(db,c.get('user'),c.req.method,path,body);
    timing.mark('T2_db_complete');
    timing.mark('T3_response_ready', { status: 200, outcome: 'success' });
    return c.json(result);
  } catch(error) {
    if(error instanceof TaskError){timing.mark('T3_response_ready',{status:error.status,outcome:'task_error'});return c.json({error:error.message},error.status as 400|403|404|409);}
    if(error instanceof ZodError){timing.mark('T3_response_ready',{status:400,outcome:'invalid_input'});return c.json({error:error.errors[0].message},400);}
    if(error instanceof SyntaxError){timing.mark('T3_response_ready',{status:400,outcome:'invalid_json'});return c.json({error:'無效的 JSON'},400);}
    console.error(JSON.stringify({event:'task_error',method:c.req.method,route:timing.route,requestId:timing.requestId,...safeTaskError(error)}));
    timing.mark('T3_response_ready', { status: 500, outcome: 'error' });
    return c.json({error:'任務操作未完成，請重新確認狀態後重試'},500);
  } finally { await disconnectPrisma(c,db); }
});
return tasks;
}
export default createTaskRoutes();
