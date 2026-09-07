const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
require('dotenv').config({path:path.join(__dirname,'../.env'),quiet:true});
const {neon}=require('@neondatabase/serverless');
const sql=neon(process.env.DATABASE_URL);
const file=path.join(__dirname,'../.release/smoke.json');
const base='https://starjar-api.ryancshung.workers.dev';
let state={marker:`release-smoke-${crypto.randomUUID()}`,users:[]};
function save(){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(state),{mode:0o600});}
async function request(p,method='GET',body,token,expected=200){
  const res=await fetch(base+p,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
  const data=await res.json();
  if(expected===200){if(!res.ok)throw Error(`${method} ${p}: ${res.status} ${JSON.stringify(data)}`);}
  else assert.equal(res.status,expected);
  return data;
}
async function cleanup(){
  if(!fs.existsSync(file))return;
  state=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!state.marker.startsWith('release-smoke-'))throw Error('Invalid cleanup marker');
  for(const u of state.users){const rows=await sql.query('SELECT email FROM "User" WHERE id=$1',[u.user.id]);if(rows.length&&rows[0].email!==u.user.email)throw Error('User cleanup identity mismatch');}
  const q=[];
  if(state.family){const rows=await sql.query('SELECT name FROM "Family" WHERE id=$1',[state.family.id]);if(rows.length&&rows[0].name!==state.marker)throw Error('Family cleanup identity mismatch');
    for(const t of ['ChallengeAward','TaskDaySnapshot','DailyTaskVersion'])q.push(sql.query(`DELETE FROM "${t}" WHERE "familyId"=$1`,[state.family.id]));
    q.push(sql.query('DELETE FROM "DailyChallengeVersion" WHERE "challengeId" IN (SELECT id FROM "DailyChallenge" WHERE "familyId"=$1)',[state.family.id]));
    q.push(sql.query('DELETE FROM "DailyChallenge" WHERE "familyId"=$1',[state.family.id]));
    q.push(sql.query('DELETE FROM "Family" WHERE id=$1 AND name=$2',[state.family.id,state.marker]));
  }
  for(const u of state.users)q.push(sql.query('DELETE FROM "User" WHERE id=$1 AND email=$2',[u.user.id,u.user.email]));
  if(q.length)await sql.transaction(q);
  const remaining=await sql.query('SELECT count(*)::int AS n FROM "User" WHERE id=ANY($1::text[])',[state.users.map(u=>u.user.id)]);
  assert.equal(remaining[0].n,0);fs.unlinkSync(file);console.log('Synthetic smoke family and users removed');
}
async function main(){
  if(process.argv[2]==='cleanup')return cleanup();
  if(fs.existsSync(file))throw Error('Prior smoke fixture exists; clean it up first');
  save();
  const register=async(role,inviteCode)=>{const u=await request('/api/auth/register','POST',{name:state.marker+'-'+role,email:`${role}-${state.marker}@example.invalid`,password:crypto.randomBytes(24).toString('hex'),role,inviteCode});state.users.push(u);save();return u;};
  const parent=await register('PARENT');state.family=(await request('/api/families','POST',{name:state.marker},parent.token)).family;save();
  const child=await register('CHILD',state.family.inviteCode);
  const tasks=[];for(const [i,points]of [5,0,5].entries())tasks.push((await request('/api/tasks','POST',{title:`Smoke ${['A','B','C'][i]}`,points,isRecurring:true,recurringType:'daily'},parent.token)).task);
  await request('/api/tasks/challenges','POST',{title:'Smoke daily combo',taskIds:tasks.map(t=>t.id),childIds:[child.user.id],bonusStars:10,customTitle:'Smoke custom reward',customDescription:'Temporary deployment verification',isActive:true},parent.token);
  const duplicates=await Promise.all(Array.from({length:4},(_,i)=>request(`/api/tasks/${tasks[0].id}/complete`,'POST',{requestId:`smoke-repeat-${i}`},child.token)));
  assert.equal(new Set(duplicates.map(r=>r.completion.id)).size,1);
  const completions=[duplicates[0].completion];for(const t of tasks.slice(1))completions.push((await request(`/api/tasks/${t.id}/complete`,'POST',{requestId:crypto.randomUUID()},child.token)).completion);
  await Promise.all(completions.map(c=>request(`/api/tasks/completions/${c.id}`,'PUT',{status:'APPROVED'},parent.token)));
  await request(`/api/tasks/completions/${completions[0].id}`,'PUT',{status:'APPROVED'},parent.token);
  const me=await request('/api/auth/me','GET',undefined,child.token);assert.equal(me.user.points,20);
  const data=await request('/api/tasks/challenges','GET',undefined,child.token);assert.equal(data.awards.length,1);assert.equal(data.awards[0].customTitle,'Smoke custom reward');
  const url=`/api/tasks/challenge-awards/${data.awards[0].id}/fulfill`;
  await request(url,'PUT',{},child.token,403);
  const fulfilled=await Promise.all([request(url,'PUT',{},parent.token),request(url,'PUT',{},parent.token)]);assert.equal(fulfilled[0].award.fulfilledAt,fulfilled[1].award.fulfilledAt);
  const report=await request('/api/reports/monthly','GET',undefined,child.token);assert.equal(report.children.length,1);assert.equal(report.children[0].challengeSummary.bonusStars,10);assert.equal(report.children[0].taskSummary.totalPoints,10);
  await request(`/api/reports/monthly?userId=${parent.user.id}`,'GET',undefined,child.token,403);
  const retry=await request(`/api/tasks/${tasks[0].id}/complete`,'POST',{requestId:'smoke-repeat-3'},child.token);assert.equal(retry.completion.id,completions[0].id);
  const counts=await sql.query('SELECT count(*)::int AS n FROM "TaskCompletion" WHERE "userId"=$1',[child.user.id]);assert.equal(counts[0].n,3);
  state.verified=true;save();console.log(JSON.stringify({passed:true,concurrentSubmissions:4,uniqueCompletions:3,concurrentApprovals:3,points:20,awards:1,fulfillmentIdempotent:true,childReportRestricted:true}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
