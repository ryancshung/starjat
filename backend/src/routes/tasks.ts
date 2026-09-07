import { Router } from 'express';
import { ZodError } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { taskRequest, TaskError } from '../lib/task-service';

const router = Router();
router.use(authenticate);
router.all('*', async (req: AuthRequest,res) => {
  try { res.json(await taskRequest(prisma,req.user!,req.method,req.path,req.body??{})); }
  catch(error) {
    if(error instanceof TaskError){res.status(error.status).json({error:error.message});return;}
    if(error instanceof ZodError){res.status(400).json({error:error.errors[0].message});return;}
    console.error(error);
    res.status(500).json({error:'任務操作未完成，請重新確認狀態後重試'});
  }
});
export default router;
