import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ChallengeInput, Task } from '../lib/api';
import { useAuth } from '../lib/auth';

const empty: ChallengeInput = {title:'',taskIds:[],childIds:[],bonusStars:10,customTitle:'',customDescription:'',isActive:true};
const field='mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-normal';
const button='min-h-11 rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50';
export function ChallengeAwards() {
  const {user}=useAuth();
  const parent=user?.role==='PARENT'||user?.role==='ADMIN';
  const qc=useQueryClient();
  const {data,error}=useQuery({queryKey:['challenges',user?.id],queryFn:api.getChallenges});
  const [busy,setBusy]=useState<string|null>(null);
  const lock=useRef(false);
  const [message,setMessage]=useState('');
  const awards=data?.awards.filter(a=>a.customTitle)??[];
  const fulfill=async(id:string)=>{
    if(lock.current)return; lock.current=true;setBusy(id);setMessage('');
    try{await api.fulfillChallengeAward(id);await qc.invalidateQueries({queryKey:['challenges']});qc.invalidateQueries({queryKey:['monthlyReport']});setMessage('已標記兌現。');}
    catch(e){setMessage(e instanceof Error?e.message:'未能確認兌現狀態，請重新整理後重試。');}
    finally{lock.current=false;setBusy(null);}
  };
  return <section className="space-y-3" aria-label="挑戰獎勵"><h2 className="text-lg font-extrabold">挑戰獎勵</h2><p className="text-sm text-slate-600">完成挑戰獲得的自訂項目，不扣星、不過期；家長提供後標記兌現。</p>
    <p role="status" className="text-sm text-slate-700">{message}</p>
    {error?<p role="alert">獎勵載入失敗，請重新整理。</p>:!data?<p role="status">載入中…</p>:!awards.length?<p className="text-sm text-slate-500">尚未獲得自訂挑戰獎勵。</p>:awards.map(a=><article key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4"><div className="min-w-0 break-words"><h3 className="font-bold">{a.customTitle}</h3>{a.customDescription&&<p className="whitespace-pre-wrap text-sm text-slate-600">{a.customDescription}</p>}<p className="text-xs text-slate-500">{parent&&`${a.user?.name} · `}{a.localDate} · {a.title}</p><p className="mt-1 text-sm font-bold">{a.fulfilledAt?'已兌現':'已獲得 · 待兌現'}</p></div>{parent&&!a.fulfilledAt&&<button type="button" disabled={busy!==null} onClick={()=>fulfill(a.id)} className={`${button} bg-primary-700 text-white`}>{busy===a.id?'處理中…':'標記已兌現'}</button>}</article>)}
  </section>;
}

export default function DailyChallenges({tasks}:{tasks:Task[]}) {
  const {user}=useAuth();
  const parent=user?.role==='PARENT'||user?.role==='ADMIN';
  const qc=useQueryClient();
  const {data,error}=useQuery({queryKey:['challenges',user?.id],queryFn:api.getChallenges,refetchInterval:30000});
  const [open,setOpen]=useState(false);
  const [editing,setEditing]=useState<string>();
  const [form,setForm]=useState<ChallengeInput>(empty);
  const [kind,setKind]=useState('stars');
  const [busy,setBusy]=useState(false);
  const lock=useRef(false);
  const [message,setMessage]=useState('');
  const eligible=tasks.map(t=>t.nextConfig??t).filter(t=>t.isRecurring&&t.recurringType==='daily'&&t.keepAfterCompletion&&t.maxCompletions==null);
  const toggle=(key:'taskIds'|'childIds',id:string)=>setForm(f=>({...f,[key]:f[key].includes(id)?f[key].filter(x=>x!==id):[...f[key],id]}));
  const save=async(e:React.FormEvent)=>{
    e.preventDefault();if(lock.current)return;
    if(!form.taskIds.length||!form.childIds.length){setMessage('請至少選擇一項任務與一位孩子。');return;}
    lock.current=true;setBusy(true);setMessage('');
    try{await api.saveChallenge({...form,bonusStars:kind==='custom'?0:form.bonusStars,customTitle:kind==='stars'?null:form.customTitle,customDescription:kind==='stars'?null:form.customDescription},editing);await qc.invalidateQueries({queryKey:['challenges']});setOpen(false);setMessage(editing?'已儲存，修改於家庭時區翌日生效。':'已建立；今天已開始任務的孩子從明天套用。');}
    catch(e){setMessage(e instanceof Error?e.message:'儲存失敗');}
    finally{lock.current=false;setBusy(false);}
  };
  const remove=async(id:string,title:string)=>{
    if(lock.current||!window.confirm(`確定刪除挑戰「${title}」嗎？明日起不再出現，今天及歷史成果會保留。`))return;
    lock.current=true;setBusy(true);setMessage('');
    try{const result=await api.deleteChallenge(id);await qc.invalidateQueries({queryKey:['challenges']});qc.invalidateQueries({queryKey:['tasks']});qc.invalidateQueries({queryKey:['monthlyReport']});setMessage(`已刪除挑戰；${result.effectiveDate} 起不再出現，歷史成果已保留。`);}
    catch(e){setMessage(e instanceof Error?e.message:'刪除挑戰失敗');}
    finally{lock.current=false;setBusy(false);}
  };
  return <section className="space-y-4" aria-label="每日挑戰">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-extrabold">每日挑戰</h2><p className="text-sm text-slate-600">全部任務通過審核，自動獲得額外獎勵。{data&&`今日 ${data.localDate}`}</p></div>{parent&&<button type="button" className={`${button} bg-primary-700 text-white print:hidden`} onClick={()=>{setEditing(undefined);setForm({...empty,taskIds:[],childIds:[]});setKind('stars');setOpen(true);setMessage('');}}>新增挑戰</button>}</div>
    <p role="status" className="text-sm text-slate-700">{message}</p>
    {open&&<form onSubmit={save} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 print:hidden" aria-label={editing?'編輯每日挑戰':'新增每日挑戰'}><h3 className="font-bold">{editing?'編輯每日挑戰 · 翌日生效':'新增每日挑戰'}</h3>
      <label className="block text-sm font-bold">挑戰名稱<input autoFocus required maxLength={100} value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} className={field}/></label>
      <fieldset><legend className="text-sm font-bold">每日任務</legend><p className="text-xs text-slate-500">選擇持續保留、無總次數上限的每日任務；每位孩子每天各完成一次。</p>{eligible.length?eligible.map(t=><label key={t.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={form.taskIds.includes(t.id)} onChange={()=>toggle('taskIds',t.id)}/>{t.title} · ⭐ {t.points}</label>):<p className="py-2 text-sm">請先在下方新增每日任務。</p>}</fieldset>
      <fieldset><legend className="text-sm font-bold">適用孩子</legend>{data?.children.map(c=><label key={c.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={form.childIds.includes(c.id)} onChange={()=>toggle('childIds',c.id)}/>{c.name}</label>)}</fieldset>
      <label className="block text-sm font-bold">額外獎勵<select className={field} value={kind} onChange={e=>setKind(e.target.value)}><option value="stars">星星</option><option value="custom">自訂項目</option><option value="both">星星＋自訂項目</option></select></label>
      {kind!=='custom'&&<label className="block text-sm font-bold">加碼星星<input type="number" required min={1} max={100000} value={form.bonusStars} onChange={e=>setForm(f=>({...f,bonusStars:Number(e.target.value)}))} className={field}/></label>}
      {kind!=='stars'&&<><label className="block text-sm font-bold">自訂獎勵名稱<input required maxLength={200} placeholder="例如：玩電動 30 分鐘" value={form.customTitle??''} onChange={e=>setForm(f=>({...f,customTitle:e.target.value}))} className={field}/></label><label className="block text-sm font-bold">獎勵說明（選填）<textarea maxLength={2000} value={form.customDescription??''} onChange={e=>setForm(f=>({...f,customDescription:e.target.value}))} className={field}/></label></>}
      {editing&&<label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={e=>setForm(f=>({...f,isActive:e.target.checked}))}/>啟用挑戰</label>}
      <div className="flex gap-2"><button type="button" disabled={busy} onClick={()=>setOpen(false)} className={`${button} bg-slate-100`}>取消</button><button disabled={busy} className={`${button} bg-primary-700 text-white`}>{busy?'儲存中…':'儲存挑戰'}</button></div>
    </form>}
    {error?<p role="alert">挑戰載入失敗，請重新整理。</p>:!data?<p role="status">載入中…</p>:<>
      {parent&&data.settings.length>0&&<details className="print:hidden"><summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">管理挑戰設定（{data.settings.length}）</summary>{data.settings.map(c=><div key={c.id} className="flex flex-col gap-2 border-b border-slate-200 py-3 sm:flex-row sm:items-center sm:justify-between"><span className="break-words text-sm">{c.title} · {c.isActive?'啟用':'停用'} · {c.effectiveDate} 起</span><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className={`${button} text-primary-700`} onClick={()=>{setEditing(c.id);setForm(c);setKind(c.customTitle?(c.bonusStars?'both':'custom'):'stars');setOpen(true);setMessage('');}}>編輯 {c.title}</button>{c.isActive&&<button type="button" disabled={busy} className={`${button} text-red-700`} onClick={()=>remove(c.id,c.title)}>{busy?'處理中…':`刪除 ${c.title}`}</button>}</div></div>)}</details>}
      {!data.progress.length&&<p className="text-sm text-slate-500">今天尚無適用的每日挑戰。</p>}
      {data.progress.map(c=><article key={`${c.id}-${c.user.id}`} className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-4"><h3 className="break-words font-bold">{parent&&`${c.user.name} · `}{c.title}</h3><p className="text-sm font-bold">已核准 {c.tasks.filter(t=>t.status==='APPROVED').length}／{c.tasks.length} · {c.bonusStars>0&&`額外 ⭐ ${c.bonusStars} `}{c.customTitle}</p>{c.customDescription&&<p className="whitespace-pre-wrap text-sm text-slate-600">{c.customDescription}</p>}<ul className="space-y-1 text-sm">{c.tasks.map(t=><li key={t.id}>{t.status==='APPROVED'?'✓ 已核准':t.status==='PENDING'?'等待審核':'尚未完成'} · {t.title}</li>)}</ul>{c.award&&<p className="text-sm font-bold text-emerald-800">{c.bonusStars>0?'加碼星星已入帳。 ':''}{c.customTitle?(c.award.fulfilledAt?'自訂獎勵已兌現。':'自訂獎勵已獲得，可到「獎勵」查看。'):'今日挑戰已達成！'}</p>}</article>)}
    </>}
  </section>;
}
