import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { localParts, zonedTimeToUtc } from './family-time';
import { evaluateTrophies } from './trophies';

type Tx = Prisma.TransactionClient;
type Actor = { userId: string; role: string };
export class TaskError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const taskInput = z.object({
  title: z.string().trim().min(1).max(200), description: z.string().max(2000).optional(),
  points: z.number().int().min(0).max(100000), isRecurring: z.boolean().optional(),
  recurringType: z.enum(['daily', 'weekly']).optional(), keepAfterCompletion: z.boolean().optional(),
  maxCompletions: z.number().int().positive().nullable().optional(), groupId: z.string().nullable().optional(),
});
export const challengeInput = z.object({
  title: z.string().trim().min(1).max(100), taskIds: z.array(z.string().min(1)).min(1).max(100),
  childIds: z.array(z.string().min(1)).min(1).max(100), bonusStars: z.number().int().min(0).max(100000),
  customTitle: z.string().trim().max(200).nullable().optional(),
  customDescription: z.string().trim().max(2000).nullable().optional(), isActive: z.boolean().default(true),
}).refine(v => v.bonusStars > 0 || Boolean(v.customTitle), '請設定加碼星星或自訂獎勵')
  .refine(v => !v.customDescription || Boolean(v.customTitle), '請填寫自訂獎勵名稱');
type TaskConfig = {
  id: string; title: string; description: string | null; points: number;
  isRecurring: boolean; recurringType: string | null; isActive: boolean;
  keepAfterCompletion: boolean; maxCompletions: number | null; groupId: string | null;
};
type ChallengeConfig = z.infer<typeof challengeInput> & { id: string };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const daily = (task: TaskConfig) => task.isRecurring && task.recurringType === 'daily';
export const nextDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
export const completionKey = (taskId: string, userId: string, date?: string) => JSON.stringify([taskId, userId, date ?? 'pending']);
export const challengeComplete = (taskIds: string[], approved: Set<string>) => taskIds.length > 0 && taskIds.every(id => approved.has(id));
const taskConfig = (t: TaskConfig): TaskConfig => ({ id:t.id, title:t.title, description:t.description, points:t.points, isRecurring:t.isRecurring, recurringType:t.recurringType, isActive:t.isActive, keepAfterCompletion:t.keepAfterCompletion, maxCompletions:t.maxCompletions, groupId:t.groupId });

async function configuredTasks(tx: Tx, familyId: string, date: string) {
  const tasks = await tx.task.findMany({ where: { familyId }, include: { group:true, createdBy:{select:{id:true,name:true}} }, orderBy:[{sortOrder:'asc'},{createdAt:'asc'}] });
  const versions = await tx.dailyTaskVersion.findMany({ where:{familyId,effectiveDate:{lte:date}}, orderBy:{effectiveDate:'desc'} });
  const groups = await tx.taskGroup.findMany({where:{familyId}});
  return tasks.map(t => {
    const version = versions.find(v => v.taskId === t.id);
    const configured={ ...t, ...(version ? version.config as unknown as TaskConfig : {}) };
    return {...configured,group:groups.find(g=>g.id===configured.groupId)??null,isActive:t.isActive&&configured.isActive};
  });
}
async function configuredChallenges(tx: Tx, familyId: string, date: string): Promise<ChallengeConfig[]> {
  const items = await tx.dailyChallenge.findMany({ where:{familyId}, include:{versions:{where:{effectiveDate:{lte:date}},orderBy:{effectiveDate:'desc'},take:1}}, orderBy:{createdAt:'asc'} });
  return items.flatMap(c => c.versions.map(v => ({ id:c.id,title:v.title,taskIds:v.taskIds as string[],childIds:v.childIds as string[],bonusStars:v.bonusStars,customTitle:v.customTitle,customDescription:v.customDescription,isActive:v.isActive })));
}
async function dayView(tx: Tx, familyId: string, userId: string, date: string) {
  const saved = await tx.taskDaySnapshot.findUnique({where:{familyId_userId_localDate:{familyId,userId,localDate:date}}});
  const current = await configuredTasks(tx,familyId,date);
  if (saved) {
    const frozen = saved.tasks as unknown as TaskConfig[];
    return { tasks:[...frozen.map(t=>({...current.find(c=>c.id===t.id),...t,isActive:t.isActive&&current.some(c=>c.id===t.id&&c.isActive)})), ...current.filter(t => !daily(t) && !frozen.some(f => f.id===t.id))], challenges:saved.challenges as unknown as ChallengeConfig[] };
  }
  return {tasks:current, challenges:(await configuredChallenges(tx,familyId,date)).filter(c => c.isActive && c.childIds.includes(userId))};
}
async function freezeDay(tx: Tx, familyId: string, userId: string, date: string) {
  const view = await dayView(tx,familyId,userId,date);
  await tx.taskDaySnapshot.upsert({where:{familyId_userId_localDate:{familyId,userId,localDate:date}},update:{},create:{familyId,userId,localDate:date,tasks:json(view.tasks.filter(t => daily(t) && t.isActive).map(taskConfig)),challenges:json(view.challenges)}});
  return view;
}
async function credit(tx: Tx, userId: string, amount: number, reason: string, actorId: string, now: Date) {
  // UPDATE obtains the user row lock, including when another subsystem changes the balance.
  const user = await tx.user.update({where:{id:userId},data:{points:{increment:amount}}});
  await tx.pointTransaction.create({data:{userId,amount,type:'EARN',reason,createdBy:actorId,balanceBefore:user.points-amount,balanceAfter:user.points,createdAt:now}});
}
async function awardChallenges(tx: Tx, familyId: string, userId: string, date: string, actorId: string, now: Date) {
  const day = await tx.taskDaySnapshot.findUnique({where:{familyId_userId_localDate:{familyId,userId,localDate:date}}});
  if (!day) return;
  const approved = new Set((await tx.taskCompletion.findMany({where:{userId,localDate:date,status:'APPROVED'}})).map(c => c.taskId));
  for (const c of day.challenges as unknown as ChallengeConfig[]) {
    if (!challengeComplete(c.taskIds,approved)) continue;
    const exists = await tx.challengeAward.findUnique({where:{challengeId_userId_localDate:{challengeId:c.id,userId,localDate:date}}});
    if (exists) continue;
    await tx.challengeAward.create({data:{familyId,challengeId:c.id,userId,localDate:date,title:c.title,bonusStars:c.bonusStars,customTitle:c.customTitle||null,customDescription:c.customDescription||null,earnedAt:now}});
    if (c.bonusStars > 0) await credit(tx,userId,c.bonusStars,`每日挑戰加碼：${c.title}（${date}）`,actorId,now);
  }
}

/** Both HTTP runtimes use this service. The family row serializes settings, submissions
 * and approvals, so the final concurrent approval always sees earlier commits. */
export async function taskRequest(db: PrismaClient, actor: Actor, method: string, path: string, body: unknown = {}, now = new Date()): Promise<any> {
  let trophyUser: string | undefined;
  const result = await db.$transaction(async tx => {
    const membership = await tx.familyMember.findFirst({where:{userId:actor.userId},include:{family:true}});
    if (!membership) throw new TaskError('請先建立或加入家庭',403);
    const familyId = membership.familyId;
    await tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id" = ${familyId} FOR UPDATE`;
    const date = localParts(now,membership.family.timezone).date;
    const parent = actor.role === 'PARENT' || actor.role === 'ADMIN';
    const requireParent = () => { if (!parent) throw new TaskError('權限不足',403); };
    const parts = path.split('/').filter(Boolean);
    const id = parts[0];

    if (id === 'challenges') {
      if (method === 'GET') {
        const members = await tx.familyMember.findMany({where:{familyId,user:{role:'CHILD'}},include:{user:{select:{id:true,name:true}}}});
        const users = parent ? members.map(m => m.user) : members.filter(m=>m.userId===actor.userId).map(m=>m.user);
        const progress = [];
        for (const user of users) {
          const view = await dayView(tx,familyId,user.id,date);
          const completions = await tx.taskCompletion.findMany({where:{userId:user.id,localDate:date}});
          const awards = await tx.challengeAward.findMany({where:{familyId,userId:user.id,localDate:date}});
          for (const c of view.challenges) progress.push({...c,user,localDate:date,tasks:c.taskIds.map(taskId=>{
            const task=view.tasks.find(t=>t.id===taskId);
            const status=completions.some(x=>x.taskId===taskId&&x.status==='APPROVED')?'APPROVED':completions.some(x=>x.taskId===taskId&&x.status==='PENDING')?'PENDING':'READY';
            return {id:taskId,title:task?.title??'任務已停用',status};
          }),award:awards.find(a=>a.challengeId===c.id)??null});
        }
        const awards = await tx.challengeAward.findMany({where:{familyId,...(!parent?{userId:actor.userId}:{})},orderBy:{earnedAt:'desc'}});
        const settings = parent ? await tx.dailyChallenge.findMany({where:{familyId},include:{versions:{orderBy:{effectiveDate:'desc'},take:1}},orderBy:{createdAt:'asc'}}) : [];
        return {localDate:date,progress,awards:awards.map(a=>({...a,user:members.find(m=>m.userId===a.userId)?.user??{id:a.userId,name:'原家庭成員'}})),settings:settings.flatMap(c=>c.versions.map(v=>({...v,id:c.id}))),children:parent?users:[]};
      }
      requireParent();
      const input = challengeInput.parse(body);
      input.taskIds = [...new Set(input.taskIds)]; input.childIds = [...new Set(input.childIds)];
      const effectiveDate = method === 'POST' ? date : nextDate(date);
      const tasks = await configuredTasks(tx,familyId,effectiveDate);
      if (input.isActive && input.taskIds.some(taskId => !tasks.some(t=>t.id===taskId&&t.isActive&&daily(t)&&t.keepAfterCompletion&&t.maxCompletions===null))) throw new TaskError('請選擇持續保留、無總次數上限的每日任務');
      if (input.isActive && await tx.familyMember.count({where:{familyId,userId:{in:input.childIds},user:{role:'CHILD'}}}) !== input.childIds.length) throw new TaskError('只能選擇同家庭的孩子',403);
      let challenge;
      if (method === 'POST' && parts.length===1) challenge=await tx.dailyChallenge.create({data:{familyId}});
      else if (method === 'PUT' && parts[1]) challenge=await tx.dailyChallenge.findFirst({where:{id:parts[1],familyId}});
      if (!challenge) throw new TaskError('找不到挑戰',404);
      const data={...input,taskIds:json(input.taskIds),childIds:json(input.childIds),customTitle:input.customTitle||null,customDescription:input.customDescription||null};
      await tx.dailyChallengeVersion.upsert({where:{challengeId_effectiveDate:{challengeId:challenge.id,effectiveDate}},create:{challengeId:challenge.id,effectiveDate,...data},update:data});
      return {challenge:{id:challenge.id,effectiveDate,...input}};
    }
    if (id === 'challenge-awards' && method==='PUT' && parts[2]==='fulfill') {
      requireParent();
      const award=await tx.challengeAward.findFirst({where:{id:parts[1],familyId}});
      if (!award || !award.customTitle) throw new TaskError('找不到可兌現獎勵',404);
      if (award.fulfilledAt) return {award};
      return {award:await tx.challengeAward.update({where:{id:award.id},data:{fulfilledAt:now,fulfilledBy:actor.userId}})};
    }
    if (id==='groups') {
      if(method==='GET') return {groups:await tx.taskGroup.findMany({where:{familyId},orderBy:{sortOrder:'asc'}})};
      requireParent();
      if(method==='POST') {
        const {name}=z.object({name:z.string().trim().min(1).max(50)}).parse(body);
        const max=await tx.taskGroup.aggregate({where:{familyId},_max:{sortOrder:true}});
        return {group:await tx.taskGroup.create({data:{familyId,name,sortOrder:(max._max.sortOrder??-1)+1}})};
      }
      const group=await tx.taskGroup.findFirst({where:{id:parts[1],familyId}});
      if(!group)throw new TaskError('群組不存在',404);
      if(method==='DELETE'){await tx.taskGroup.delete({where:{id:group.id}});return {success:true};}
      const {name}=z.object({name:z.string().trim().min(1).max(50)}).parse(body);
      return {group:await tx.taskGroup.update({where:{id:group.id},data:{name}})};
    }
    if (method==='GET' && !id) {
      const view=await dayView(tx,familyId,actor.userId,date);
      const current=await configuredTasks(tx,familyId,date);
      const tasks=parent?current:view.tasks;
      const pending=await tx.taskCompletion.findMany({where:{task:{familyId},status:'PENDING'},include:{user:{select:{id:true,name:true}}}});
      const approved=await tx.taskCompletion.findMany({where:{userId:actor.userId,status:'APPROVED',localDate:date}});
      // Include legacy approvals from today without changing their historical rows.
      const lp=localParts(now,membership.family.timezone);
      const start=zonedTimeToUtc(lp.year,lp.month,lp.day,0,0,membership.family.timezone);
      const legacy=await tx.taskCompletion.findMany({where:{userId:actor.userId,status:'APPROVED',localDate:null,completedAt:{gte:start,lte:now}}});
      const future=parent?await configuredTasks(tx,familyId,nextDate(date)):[];
      return {localDate:date,tasks:tasks.filter(t=>t.isActive).map(t=>({...t,completions:pending.filter(c=>c.taskId===t.id&&(parent||c.userId===actor.userId)),myStatus:daily(t)&&[...approved,...legacy].some(c=>c.taskId===t.id)?'APPROVED':pending.some(c=>c.taskId===t.id&&c.userId===actor.userId&&(!daily(t)||c.localDate===date||c.localDate===null))?'PENDING':'READY',...(parent?{nextConfig:future.find(f=>f.id===t.id)}:{})}))};
    }
    if(id==='pending'&&method==='GET') {
      requireParent();return {completions:await tx.taskCompletion.findMany({where:{status:'PENDING',task:{familyId}},include:{task:true,user:{select:{id:true,name:true}}},orderBy:{completedAt:'desc'}})};
    }
    if(id==='order'&&method==='PUT') {
      requireParent();const {ids}=z.object({ids:z.array(z.string()).min(1)}).parse(body);
      if(new Set(ids).size!==ids.length||await tx.task.count({where:{familyId,id:{in:ids}}})!==ids.length)throw new TaskError('無效的排序',400);
      for(const [sortOrder,taskId]of ids.entries())await tx.task.update({where:{id:taskId},data:{sortOrder}});
      return {success:true};
    }
    if(parts[1]==='complete'&&method==='POST') {
      if(actor.role!=='CHILD')throw new TaskError('請使用孩子帳號提交',403);
      const input=z.object({requestId:z.string().min(8).max(100).optional(),note:z.string().max(2000).optional()}).parse(body);
      const remember=async(completion:Awaited<ReturnType<Tx['taskCompletion']['findFirstOrThrow']>>)=>{
        if(input.requestId)await tx.taskSubmissionRequest.upsert({where:{userId_requestId:{userId:actor.userId,requestId:input.requestId}},update:{},create:{userId:actor.userId,requestId:input.requestId,completionId:completion.id}});
        return {completion};
      };
      if(input.requestId){const previous=await tx.taskSubmissionRequest.findUnique({where:{userId_requestId:{userId:actor.userId,requestId:input.requestId}},include:{completion:true}});if(previous){if(previous.completion.taskId!==id)throw new TaskError('申請識別碼已使用',409);return {completion:previous.completion};}}
      const view=await freezeDay(tx,familyId,actor.userId,date);
      const task=view.tasks.find(t=>t.id===id&&t.isActive);
      if(!task)throw new TaskError('任務不存在或已停用',404);
      const source=await tx.task.findFirst({where:{id,familyId,isActive:true}});
      if(!source)throw new TaskError('任務已停用',404);
      const isDaily=daily(task);
      const existing=await tx.taskCompletion.findFirst({where:{taskId:id,userId:actor.userId,...(isDaily?{OR:[{localDate:date,status:{in:['PENDING','APPROVED']}},{localDate:null,status:'PENDING'}]}:{status:'PENDING'})}});
      if(existing)return remember(existing);
      if(isDaily){const lp=localParts(now,membership.family.timezone);const start=zonedTimeToUtc(lp.year,lp.month,lp.day,0,0,membership.family.timezone);const old=await tx.taskCompletion.findFirst({where:{taskId:id,userId:actor.userId,status:'APPROVED',localDate:null,completedAt:{gte:start,lte:now}}});if(old)return remember(old);}
      if(task.maxCompletions!==null&&await tx.taskCompletion.count({where:{taskId:id,status:'APPROVED'}})>=task.maxCompletions)throw new TaskError('此任務已達完成次數上限');
      return remember(await tx.taskCompletion.create({data:{taskId:id,userId:actor.userId,requestId:input.requestId,note:input.note,localDate:date,pointsSnapshot:task.points,titleSnapshot:task.title,activeKey:completionKey(id,actor.userId,isDaily?date:undefined),completedAt:now}}));
    }
    if(id==='completions'&&method==='PUT') {
      requireParent();const {status}=z.object({status:z.enum(['APPROVED','REJECTED'])}).parse(body);
      const c=await tx.taskCompletion.findFirst({where:{id:parts[1],task:{familyId}},include:{task:true}});
      if(!c)throw new TaskError('找不到申請',404);
      if(c.status!=='PENDING'){if(c.status===status)return {completion:c};throw new TaskError('申請已被處理',409);}
      const day=c.localDate?await tx.taskDaySnapshot.findUnique({where:{familyId_userId_localDate:{familyId,userId:c.userId,localDate:c.localDate}}}):null;
      const original=(day?.tasks as unknown as TaskConfig[]|undefined)?.find(t=>t.id===c.taskId)??c.task;
      if(status==='APPROVED'&&original.maxCompletions!==null&&await tx.taskCompletion.count({where:{taskId:c.taskId,status:'APPROVED'}})>=original.maxCompletions)throw new TaskError('此任務已達完成次數上限');
      const completion=await tx.taskCompletion.update({where:{id:c.id},data:{status,reviewedAt:now,reviewedBy:actor.userId,activeKey:status==='APPROVED'&&c.localDate&&daily(original)?completionKey(c.taskId,c.userId,c.localDate):null}});
      if(status==='APPROVED'){
        await credit(tx,c.userId,c.pointsSnapshot??c.task.points,`完成任務：${c.titleSnapshot??c.task.title}`,actor.userId,now);
        if(c.localDate)await awardChallenges(tx,familyId,c.userId,c.localDate,actor.userId,now);
        if(!original.keepAfterCompletion)await tx.task.update({where:{id:c.taskId},data:{isActive:false}});
        trophyUser=c.userId;
      }
      return {completion};
    }
    requireParent();
    if(method==='POST'&&!id){
      const input=taskInput.parse(body);
      if(input.groupId&&!await tx.taskGroup.findFirst({where:{id:input.groupId,familyId}}))throw new TaskError('無效的任務群組');
      const max=await tx.task.aggregate({where:{familyId},_max:{sortOrder:true}});
      const task=await tx.task.create({data:{...input,familyId,createdById:actor.userId,sortOrder:(max._max.sortOrder??-1)+1}});
      return {task};
    }
    const task=await tx.task.findFirst({where:{id,familyId}});
    if(!task)throw new TaskError('找不到任務',404);
    const tomorrow=nextDate(date);
    if(method==='PUT'||method==='DELETE'){
      const input=method==='DELETE'?{isActive:false}:taskInput.partial().parse(body);
      if('groupId'in input&&input.groupId&&!await tx.taskGroup.findFirst({where:{id:input.groupId,familyId}}))throw new TaskError('無效的任務群組');
      const current=(await configuredTasks(tx,familyId,date)).find(t=>t.id===id)!;
      const future=(await configuredTasks(tx,familyId,tomorrow)).find(t=>t.id===id)!;
      const updated={...taskConfig(future),...input};
      if('isRecurring'in input&&input.isRecurring===false)updated.recurringType=null;
      const affected=(await configuredChallenges(tx,familyId,tomorrow)).some(c=>c.isActive&&c.taskIds.includes(id));
      if(affected&&(!updated.isActive||!daily(updated)||!updated.keepAfterCompletion||updated.maxCompletions!==null))throw new TaskError('此任務仍在啟用的挑戰中，請先修改或停用挑戰');
      if(daily(current)||daily(updated)){
        await tx.dailyTaskVersion.upsert({where:{taskId_effectiveDate:{taskId:id,effectiveDate:date}},update:{},create:{taskId:id,familyId,effectiveDate:date,config:json(taskConfig(current))}});
        await tx.dailyTaskVersion.upsert({where:{taskId_effectiveDate:{taskId:id,effectiveDate:tomorrow}},update:{config:json(updated)},create:{taskId:id,familyId,effectiveDate:tomorrow,config:json(updated)}});
        return {task:updated,effectiveDate:tomorrow,success:true,archived:method==='DELETE'};
      }
      if(method==='DELETE'){
        // Preserve references and all historical records, including challenge snapshots.
        await tx.task.update({where:{id},data:{isActive:false}});return {success:true,archived:true};
      }
      const {id:_,...data}=updated;
      return {task:await tx.task.update({where:{id},data})};
    }
    throw new TaskError('找不到此 API',404);
  }, {maxWait:10000,timeout:30000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
  if(trophyUser)await evaluateTrophies(db,trophyUser).catch(error=>console.error('Task committed; trophy evaluation failed',error));
  return result;
}
