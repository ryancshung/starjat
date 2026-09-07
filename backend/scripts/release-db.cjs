const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({path:path.join(__dirname,'../.env'),quiet:true});
const {neon} = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const dir=path.join(__dirname,'../prisma/migrations/20260907_daily_challenges');
const name='20260907_daily_challenges';
const file=fs.readFileSync(path.join(dir,'migration.sql'),'utf8').replace(/\r\n/g,'\n');
const checksum=crypto.createHash('sha256').update(file).digest('hex');
const mode=process.argv[2]??'check';

async function check(){
  const tables=await sql.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
  const names=tables.map(r=>r.table_name);
  const pending=await sql.query(`SELECT "taskId","userId",count(*)::int AS count,array_agg("id") AS ids FROM "TaskCompletion" WHERE status='PENDING' GROUP BY "taskId","userId" HAVING count(*)>1`);
  const columns=await sql.query(`SELECT column_name FROM information_schema.columns WHERE table_name='TaskCompletion' AND table_schema='public' ORDER BY ordinal_position`);
  const migrations=names.includes('_prisma_migrations')?await sql.query(`SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`):[];
  console.log(JSON.stringify({databaseHost:new URL(process.env.DATABASE_URL).hostname,tables:names,completionColumns:columns.map(r=>r.column_name),duplicatePending:pending,migrations},null,2));
  return {names,pending,migrations};
}
async function main(){
  const state=await check();
  if(mode==='check')return;
  if(mode==='backup'){
    const tables=state.names;
    const result=await sql.transaction(tables.map(t=>sql.query(`SELECT * FROM "${t.replaceAll('"','""')}"`)),{isolationLevel:'RepeatableRead',readOnly:true});
    const backup={createdAt:new Date().toISOString(),tables:Object.fromEntries(tables.map((t,i)=>[t,result[i]]))};
    const out=path.join(__dirname,'../.release');fs.mkdirSync(out,{recursive:true});
    const bytes=JSON.stringify(backup);const target=path.join(out,`backup-${Date.now()}.json`);fs.writeFileSync(target,bytes,{mode:0o600});
    console.log(JSON.stringify({backup:target,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),counts:Object.fromEntries(tables.map((t,i)=>[t,result[i].length]))}));return;
  }
  if(mode!=='migrate')throw Error('Unknown mode');
  if(state.pending.length)throw Error('Duplicate pending submissions require explicit resolution');
  const existing=state.migrations.find(m=>m.migration_name===name);
  if(existing){if(existing.finished_at&&existing.checksum===checksum){console.log('Migration already applied and checksum matches');return;}throw Error('Existing migration is incomplete or has a different checksum');}
  if(!state.names.includes('_prisma_migrations'))throw Error('Migration history must be established first');
  if(state.names.includes('DailyChallenge'))throw Error('Unexpected partial migration; investigate before proceeding');
  // Preserve the DO block as one prepared statement; all remaining statements are DDL.
  const guard=file.match(/DO \$\$[\s\S]*?\$\$;/);
  if(!guard)throw Error('Missing migration preflight guard');
  const rest=file.slice(guard.index+guard[0].length).split(';').map(s=>s.trim()).filter(Boolean);
  const statements=[guard[0].slice(0,-1),...rest];
  const queries=[sql.query(`LOCK TABLE "TaskCompletion" IN ACCESS EXCLUSIVE MODE`),...statements.map(s=>sql.query(s)),sql.query(`INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count) VALUES ($1,$2,$3,now(),now(),1)`,[crypto.randomUUID(),checksum,name])];
  await sql.transaction(queries);
  console.log(JSON.stringify({applied:name,checksum,statements:statements.length}));
  await check();
}
main().catch(e=>{console.error({name:e.name,code:e.code,message:e.message?.replaceAll(process.env.DATABASE_URL??'__none__','[REDACTED]')});process.exitCode=1;});
