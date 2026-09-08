import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaClient } from '@prisma/client';
import { taskRequest, challengeInput, nextDate } from '../src/lib/task-service';
import { monthlyChallengeSummary } from '../src/lib/challenge-report';
import { createReportRoutes } from '../src/worker-routes/reports';
import { createTaskRoutes } from '../src/worker-routes/tasks';
import { createRewardRoutes } from '../src/worker-routes/rewards';
import { signToken } from '../src/lib/auth';

let pg:PGlite, server:PGLiteSocketServer, db:PrismaClient;
const parent={userId:'parent',role:'PARENT'}, admin={userId:'admin',role:'ADMIN'}, child={userId:'child',role:'CHILD'}, sibling={userId:'sibling',role:'CHILD'};
const today=new Date('2026-09-07T04:00:00Z'), tomorrow=new Date('2026-09-08T04:00:00Z');
const run=(actor:typeof parent,method:string,path:string,body:unknown={},now=today)=>taskRequest(db,actor,method,path,body,now);
before(async()=>{
  pg=await PGlite.create();
  await pg.exec(readFileSync('tests/fixtures/before-challenges.sql','utf8'));
  await pg.exec(readFileSync('prisma/migrations/20260907_daily_challenges/migration.sql','utf8'));
  server=new PGLiteSocketServer({db:pg,host:'127.0.0.1',port:0,maxConnections:1});
  await server.start();
  // One physical connection in PGlite; requests still exercise real SQL, transactions,
  // unique constraints and retry behavior. Production lock contention needs PostgreSQL.
  db=new PrismaClient({datasourceUrl:`postgresql://postgres:postgres@${server.getServerConn()}/postgres?connection_limit=1&pool_timeout=30&sslmode=disable`});
  await db.$connect();
});
after(async()=>{await db?.$disconnect();await server?.stop();await pg?.close();});
beforeEach(async()=>{
  await pg.exec('TRUNCATE "ChallengeAward","TaskDaySnapshot","DailyChallengeVersion","DailyChallenge","DailyTaskVersion","User","Family" CASCADE');
  await db.user.createMany({data:[{id:'parent',email:'parent@test.invalid',name:'家長',role:'PARENT',passwordHash:'test'},{id:'admin',email:'admin@test.invalid',name:'管理者',role:'ADMIN',passwordHash:'test'},{id:'child',email:'child@test.invalid',name:'孩子',role:'CHILD',passwordHash:'test'},{id:'sibling',email:'sibling@test.invalid',name:'手足',role:'CHILD',passwordHash:'test'},{id:'outsider',email:'outsider@test.invalid',name:'外人',role:'PARENT',passwordHash:'test'}]});
  await db.family.create({data:{id:'family',name:'測試家庭',inviteCode:'TEST',ownerId:'parent'}});
  await db.family.create({data:{id:'other',name:'其他家庭',inviteCode:'OTHER',ownerId:'outsider'}});
  await db.familyMember.createMany({data:['parent','admin','child','sibling'].map(userId=>({userId,familyId:'family'})).concat([{userId:'outsider',familyId:'other'}])});
  await db.task.createMany({data:[5,0,5].map((points,i)=>({id:`task${i}`,familyId:'family',createdById:'parent',title:['A','B','C'][i],points,isRecurring:true,recurringType:'daily'}))});
});
async function challenge(overrides:Record<string,unknown>={}) {
  return (await run(parent,'POST','/challenges',{title:'每日 ABC',taskIds:['task0','task1','task2'],childIds:['child','sibling'],bonusStars:10,customTitle:null,isActive:true,...overrides})).challenge;
}
async function submit(taskId:string,actor=child,now=today,requestId=`request-${taskId}-${actor.userId}-${now.toISOString()}`){return (await run(actor,'POST',`/${taskId}/complete`,{requestId},now)).completion;}
async function approve(id:string,now=today){return run(parent,'PUT',`/completions/${id}`,{status:'APPROVED'},now);}
test('5/0/5 plus 10 gives 20 only after all approved; duplicate submissions/reviews do not pay twice',async()=>{
  await challenge();
  const responses=await Promise.all(Array.from({length:8},(_,i)=>submit('task0',child,today,`parallel-request-${i}`)));
  assert.equal(new Set(responses.map(r=>r.id)).size,1);
  await Promise.all([approve(responses[0].id),approve(responses[0].id)]);
  assert.equal((await db.user.findUniqueOrThrow({where:{id:'child'}})).points,5);
  assert.equal(await db.challengeAward.count(),0);
  const b=await submit('task1'),c=await submit('task2');
  await Promise.all([approve(b.id),approve(c.id)]);
  assert.equal((await db.user.findUniqueOrThrow({where:{id:'child'}})).points,20);
  assert.equal(await db.challengeAward.count(),1);
  assert.equal((await submit('task0')).id,responses[0].id);
  assert.equal(await db.pointTransaction.count({where:{userId:'child'}}),4);
});
test('custom-only and mixed overlapping challenges share basic points and fulfill once',async()=>{
  await challenge({title:'自訂',bonusStars:0,customTitle:'電動 30 分鐘'});
  await challenge({title:'混合',bonusStars:10,customTitle:'選晚餐'});
  for(const id of ['task0','task1','task2'])await approve((await submit(id)).id);
  assert.equal((await db.user.findUniqueOrThrow({where:{id:'child'}})).points,20);
  const awards=await db.challengeAward.findMany();assert.equal(awards.length,2);
  await assert.rejects(run(child,'PUT',`/challenge-awards/${awards[0].id}/fulfill`),/權限/);
  await assert.rejects(run({userId:'outsider',role:'PARENT'},'PUT',`/challenge-awards/${awards[0].id}/fulfill`),/找不到/);
  const results=await Promise.all([run(parent,'PUT',`/challenge-awards/${awards[0].id}/fulfill`),run(parent,'PUT',`/challenge-awards/${awards[0].id}/fulfill`)]);
  assert.equal(results[0].award.fulfilledAt.getTime(),results[1].award.fulfilledAt.getTime());
  assert.equal((await db.user.findUniqueOrThrow({where:{id:'child'}})).points,20);
  assert.equal((await run(sibling,'GET','/challenges')).awards.length,0);
});
test('rejection can be resubmitted; old request replay stays rejected',async()=>{
  const first=await submit('task0',child,today,'first-request');
  await run(parent,'PUT',`/completions/${first.id}`,{status:'REJECTED'});
  assert.equal((await submit('task0',child,today,'first-request')).status,'REJECTED');
  const retry=await submit('task0',child,today,'retry-request');assert.notEqual(retry.id,first.id);
  await approve(retry.id);assert.equal((await db.user.findUniqueOrThrow({where:{id:'child'}})).points,5);
});
test('parents and admins permanently delete only rejected task applications in their family',async()=>{
  const rejected=await submit('task0',child,today,'delete-rejected');
  await run(parent,'PUT',`/completions/${rejected.id}`,{status:'REJECTED'});
  const pending=await submit('task1',child,today,'keep-pending');
  assert.equal((await run(parent,'GET','/pending')).rejectedCompletions.length,1);
  await assert.rejects(run(child,'DELETE',`/completions/${rejected.id}`),/權限/);
  await assert.rejects(run({userId:'outsider',role:'PARENT'},'DELETE',`/completions/${rejected.id}`),/找不到/);
  await assert.rejects(run(parent,'DELETE',`/completions/${pending.id}`),/只能刪除/);
  await run(admin,'DELETE',`/completions/${rejected.id}`);
  assert.equal(await db.taskCompletion.count({where:{id:rejected.id}}),0);
  assert.equal(await db.taskSubmissionRequest.count({where:{completionId:rejected.id}}),0);
  await assert.rejects(run(parent,'DELETE',`/completions/${rejected.id}`),/找不到/);
});
test('next-day approval uses submission day and frozen rewards; next day has independent applications',async()=>{
  const ch=await challenge({customTitle:'原本獎勵'});
  const a=await submit('task0');
  await run(parent,'PUT','/task1',{points:50});
  await run(parent,'PUT',`/challenges/${ch.id}`,{...ch,bonusStars:100,customTitle:'明日獎勵'});
  const b=await submit('task1'),c=await submit('task2');
  assert.equal(b.pointsSnapshot,0);
  // A child that had not submitted yet also sees today's original task settings.
  assert.equal((await run(sibling,'GET','/')).tasks.find((t:any)=>t.id==='task1').points,0);
  for(const x of [a,b,c])await approve(x.id,tomorrow);
  assert.equal((await db.user.findUniqueOrThrow({where:{id:'child'}})).points,20);
  const award=await db.challengeAward.findFirstOrThrow();assert.equal(award.localDate,'2026-09-07');assert.equal(award.customTitle,'原本獎勵');
  const next=await submit('task1',child,tomorrow);assert.equal(next.pointsSnapshot,50);assert.equal(next.localDate,'2026-09-08');
  assert.equal((await run(child,'GET','/challenges',{},tomorrow)).progress[0].customTitle,'明日獎勵');
});
test('different children earn independently and tomorrow does not overwrite unreviewed yesterday',async()=>{
  await challenge({taskIds:['task0'],bonusStars:2});
  const one=await submit('task0'),two=await submit('task0',sibling),next=await submit('task0',child,tomorrow);
  assert.notEqual(one.id,next.id);
  await approve(one.id,tomorrow);await approve(two.id);await approve(next.id,tomorrow);
  assert.equal(await db.challengeAward.count(),3);
  assert.equal((await db.user.findUniqueOrThrow({where:{id:'child'}})).points,14);
  assert.equal((await db.user.findUniqueOrThrow({where:{id:'sibling'}})).points,7);
});
test('cannot target foreign child/task, parent cannot submit, child cannot configure',async()=>{
  await assert.rejects(challenge({childIds:['outsider']}),/同家庭/);
  await assert.rejects(challenge({taskIds:['missing']}),/每日任務/);
  await assert.rejects(run(child,'POST','/challenges',{}),/權限/);
  await assert.rejects(submit('task0',parent),/孩子帳號/);
  await assert.rejects(run({userId:'outsider',role:'PARENT'},'PUT','/task0',{points:99}),/找不到/);
  assert.equal(challengeInput.safeParse({title:'x',taskIds:['task0'],childIds:['child'],bonusStars:0}).success,false);
});
test('SQL unique constraints reject duplicate award and active completion; transaction rolls back',async()=>{
  await challenge({taskIds:['task0']});await approve((await submit('task0')).id);
  const award=await db.challengeAward.findFirstOrThrow();
  await assert.rejects(pg.query('INSERT INTO "ChallengeAward" SELECT $1,"familyId","challengeId","userId","localDate","title","bonusStars","customTitle","customDescription","earnedAt","fulfilledAt","fulfilledBy" FROM "ChallengeAward" WHERE "id"=$2',['duplicate',award.id]),/unique/);
  const c=await db.taskCompletion.findFirstOrThrow();
  await assert.rejects(pg.query('INSERT INTO "TaskCompletion" ("id","taskId","userId","activeKey") VALUES ($1,$2,$3,$4)',['duplicate-completion',c.taskId,c.userId,c.activeKey]),/unique/);
  assert.equal(await db.challengeAward.count(),1);
});
test('report counts actual earned month and excludes custom item value from stars',async()=>{
  await challenge({taskIds:['task0'],bonusStars:0,customTitle:'看電影'});
  await approve((await submit('task0')).id);
  await db.challengeAward.updateMany({data:{earnedAt:new Date('2026-10-01T01:00:00Z')}});
  const september=await monthlyChallengeSummary(db,'child',new Date('2026-09-01Z'),new Date('2026-10-01Z'));
  const october=await monthlyChallengeSummary(db,'child',new Date('2026-10-01Z'),new Date('2026-11-01Z'));
  assert.equal(september.awards.length,0);assert.equal(october.awards.length,1);assert.equal(october.bonusStars,0);
});
test('calendar date increment handles month and year boundaries',()=>{assert.equal(nextDate('2026-12-31'),'2027-01-01');assert.equal(nextDate('2028-02-28'),'2028-02-29');});

test('daily one-time task remains inactive after approval even with a version and another child snapshot',async()=>{
  await run(parent,'PUT','/task0',{keepAfterCompletion:false});
  await submit('task1',sibling,tomorrow);
  await approve((await submit('task0',child,tomorrow)).id,tomorrow);
  assert.equal((await run(sibling,'GET','/',{},tomorrow)).tasks.some((t:any)=>t.id==='task0'),false);
  await assert.rejects(submit('task0',sibling,tomorrow),/停用|不存在/);
});

test('every request ID resolving to an existing pending regular task remains idempotent after approval',async()=>{
  await db.task.update({where:{id:'task0'},data:{isRecurring:false,recurringType:null}});
  const a=await submit('task0',child,today,'original-request');
  const b=await submit('task0',child,today,'second-request');assert.equal(a.id,b.id);
  await approve(a.id);
  assert.equal((await submit('task0',child,today,'second-request')).id,a.id);
  assert.equal((await db.user.findUniqueOrThrow({where:{id:'child'}})).points,5);
});
test('failure during award creation rolls approval and basic credit back together',async()=>{
  await challenge({taskIds:['task0']});const c=await submit('task0');
  const broken=new Proxy(db,{get(target,key){
    if(key==='$transaction')return (fn:any,options:any)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='challengeAward')return {...t.challengeAward,create:async()=>{throw new Error('simulated failure');}};return Reflect.get(t,k);}})),options);
    return Reflect.get(target,key);
  }});
  await assert.rejects(taskRequest(broken,parent,'PUT',`/completions/${c.id}`,{status:'APPROVED'},today),/simulated failure/);
  assert.equal((await db.taskCompletion.findUniqueOrThrow({where:{id:c.id}})).status,'PENDING');
  assert.equal((await db.user.findUniqueOrThrow({where:{id:'child'}})).points,0);
  assert.equal(await db.pointTransaction.count(),0);
  await approve(c.id);assert.equal((await db.user.findUniqueOrThrow({where:{id:'child'}})).points,15);
});
test('new challenge after first submission starts tomorrow; disabling keeps historical award available',async()=>{
  await submit('task0');const c=await challenge({taskIds:['task0'],customTitle:'玩遊戲'});
  assert.equal((await run(child,'GET','/challenges')).progress.length,0);
  assert.equal((await run(child,'GET','/challenges',{},tomorrow)).progress.length,1);
  await approve((await submit('task0',child,tomorrow)).id,tomorrow);
  await run(parent,'PUT',`/challenges/${c.id}`,{...c,isActive:false},tomorrow);
  const dayAfter=new Date('2026-09-09T04:00:00Z');
  assert.equal((await run(child,'GET','/challenges',{},dayAfter)).progress.length,0);
  assert.equal((await run(child,'GET','/challenges',{},dayAfter)).awards.length,1);
});
test('deleting a challenge disables it tomorrow and preserves today, awards, and point history',async()=>{
  const c=await challenge({taskIds:['task0'],bonusStars:2});
  await approve((await submit('task0')).id);
  const beforeTransactions=await db.pointTransaction.count();
  const result=await run(parent,'DELETE',`/challenges/${c.id}`);
  assert.equal(result.effectiveDate,'2026-09-08');
  assert.equal((await run(child,'GET','/challenges')).progress.length,1);
  assert.equal((await run(child,'GET','/challenges',{},tomorrow)).progress.length,0);
  assert.equal(await db.challengeAward.count({where:{challengeId:c.id}}),1);
  assert.equal(await db.pointTransaction.count(),beforeTransactions);
  await assert.rejects(run(child,'DELETE',`/challenges/${c.id}`),/權限/);
  await assert.rejects(run(parent,'DELETE',`/challenges/${c.id}`,{},tomorrow),/找不到/);
});

test('reward routes permanently delete only same-family rejected wishes and redemptions',async()=>{
  const reward=await db.reward.create({data:{id:'reward',familyId:'family',createdById:'parent',title:'看電影',cost:10}});
  const rejectedWish=await db.wish.create({data:{id:'wish-rejected',familyId:'family',userId:'child',title:'腳踏車',status:'REJECTED'}});
  const pendingWish=await db.wish.create({data:{id:'wish-pending',familyId:'family',userId:'child',title:'書',status:'PENDING'}});
  const rejectedRedemption=await db.rewardRedemption.create({data:{id:'redemption-rejected',rewardId:reward.id,userId:'child',status:'REJECTED',reservedPoints:10}});
  const pendingRedemption=await db.rewardRedemption.create({data:{id:'redemption-pending',rewardId:reward.id,userId:'child',status:'PENDING',reservedPoints:10}});
  const app=createRewardRoutes(()=>db),env={DATABASE_URL:'unused-test',JWT_SECRET:'test-secret'};
  const call=(actor:typeof parent,path:string)=>app.request(`http://localhost${path}`,{method:'DELETE',headers:{Authorization:`Bearer ${signToken({...actor,email:`${actor.userId}@test.invalid`},'test-secret')}`}},env);
  assert.equal((await call(child,`/wishes/${rejectedWish.id}`)).status,403);
  assert.equal((await call({userId:'outsider',role:'PARENT'},`/wishes/${rejectedWish.id}`)).status,404);
  assert.equal((await call(parent,`/wishes/${pendingWish.id}`)).status,409);
  assert.equal((await call(admin,`/wishes/${rejectedWish.id}`)).status,200);
  assert.equal((await call(parent,`/wishes/${rejectedWish.id}`)).status,404);
  assert.equal((await call(parent,`/redemptions/${pendingRedemption.id}`)).status,409);
  assert.equal((await call(admin,`/redemptions/${rejectedRedemption.id}`)).status,200);
  assert.equal(await db.wish.count({where:{id:rejectedWish.id}}),0);
  assert.equal(await db.rewardRedemption.count({where:{id:rejectedRedemption.id}}),0);
});
test('family-local midnight resets daily task and same-day legacy approval does not pay again',async()=>{
  const beforeMidnight=new Date('2026-09-07T15:59:59Z'),afterMidnight=new Date('2026-09-07T16:00:01Z');
  const a=await submit('task0',child,beforeMidnight),b=await submit('task0',child,afterMidnight);
  assert.equal(a.localDate,'2026-09-07');assert.equal(b.localDate,'2026-09-08');
  await db.taskCompletion.create({data:{taskId:'task1',userId:'child',status:'APPROVED',completedAt:today}});
  const legacy=await submit('task1');assert.equal(legacy.status,'APPROVED');assert.equal(legacy.localDate,null);
  assert.equal(await db.taskCompletion.count({where:{taskId:'task1'}}),1);
});
test('Worker task adapter accepts authenticated route and rejects parent completion',async()=>{
  const app=createTaskRoutes(()=>db),env={DATABASE_URL:'unused-test',JWT_SECRET:'test-secret'};
  const token=signToken({...parent,email:'p@test.invalid'},'test-secret');
  const response=await app.request('http://localhost/api/tasks/task0/complete',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requestId:'parent-request'})},env);
  assert.equal(response.status,403);
  const anonymous=await app.request('http://localhost/api/tasks',{},env);assert.equal(anonymous.status,401);
});
test('monthly report permits parents, restricts children to self, rejects cross-family and invalid month',async()=>{
  const app=createReportRoutes(()=>db),env={DATABASE_URL:'unused-test',JWT_SECRET:'test-secret'};
  const get=async(actor:typeof parent,query='')=>app.request(`http://localhost/monthly?month=2026-09${query}`,{headers:{Authorization:`Bearer ${signToken({...actor,email:'test@test.invalid'},'test-secret')}`}},env);
  const p=await get(parent);assert.equal(p.status,200);assert.equal((await p.json() as any).children.length,2);
  const c=await get(child);assert.equal(c.status,200);assert.equal((await c.json() as any).children.length,1);
  assert.equal((await get(child,'&userId=sibling')).status,403);
  assert.equal((await get(parent,'&userId=outsider')).status,403);
  const invalid=await app.request('http://localhost/monthly?month=bad',{headers:{Authorization:`Bearer ${signToken({...parent,email:'p@test.invalid'},'test-secret')}`}},env);assert.equal(invalid.status,400);
});
test('migration preflight reports duplicate pending rows and guard stops without deleting history',async()=>{
  const legacy=await PGlite.create();
  try{
    await legacy.exec(readFileSync('tests/fixtures/before-challenges.sql','utf8'));
    // Preflight tests only need the completion records; disable FK checks for this fixture.
    await legacy.exec(`SET session_replication_role='replica'; INSERT INTO "TaskCompletion" ("id","taskId","userId") VALUES ('one','task','child'),('two','task','child'); SET session_replication_role='origin';`);
    const result=await legacy.exec(readFileSync('prisma/migrations/20260907_daily_challenges/preflight.sql','utf8'));
    assert.equal(result[0].rows.length,1);
    await assert.rejects(legacy.exec(readFileSync('prisma/migrations/20260907_daily_challenges/migration.sql','utf8')),/Duplicate pending/);
    assert.equal((await legacy.query('SELECT * FROM "TaskCompletion"')).rows.length,2);
  }finally{await legacy.close();}
});
