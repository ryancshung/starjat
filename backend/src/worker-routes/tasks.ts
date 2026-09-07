import { Hono } from 'hono';
import { ZodError } from 'zod';
import { createPrisma } from '../lib/worker-prisma';
import { taskRequest, TaskError } from '../lib/task-service';
import { authenticate, type WorkerRouteEnv } from './shared';

export function createTaskRoutes(getDb = createPrisma) {
const tasks = new Hono<WorkerRouteEnv>();
tasks.use('*', authenticate);
tasks.all('*', async c => {
  const db = getDb(c.env.DATABASE_URL);
  try {
    const path = new URL(c.req.url).pathname.replace(/^\/api\/tasks/, '');
    const body = ['POST','PUT'].includes(c.req.method) ? await c.req.json() : {};
    return c.json(await taskRequest(db,c.get('user'),c.req.method,path,body));
  } catch(error) {
    if(error instanceof TaskError)return c.json({error:error.message},error.status as 400|403|404|409);
    if(error instanceof ZodError)return c.json({error:error.errors[0].message},400);
    if(error instanceof SyntaxError)return c.json({error:'無效的 JSON'},400);
    console.error(error);
    return c.json({error:'任務操作未完成，請重新確認狀態後重試'},500);
  } finally { await db.$disconnect(); }
});
return tasks;
}
export default createTaskRoutes();
