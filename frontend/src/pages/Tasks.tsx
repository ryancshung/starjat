import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import DailyChallenges from '../components/DailyChallenges';
import { taskRequestId, clearTaskRequestId } from '../lib/task-request-key';
import { api, Task } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Tasks() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isParent = user?.role === 'PARENT' || user?.role === 'ADMIN';

  const { data, isLoading, error } = useQuery({
    queryKey: ['tasks', user?.id],
    queryFn: api.getTasks,
    refetchInterval: 30000,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    points: 5,
    isRecurring: false,
    recurringType: 'daily' as 'daily' | 'weekly',
    keepAfterCompletion: true,
    maxCompletions: '',
    groupId: '',
  });
  const [loading, setLoading] = useState(false);
  const submitting = useRef(new Set<string>());
  const [busyTasks, setBusyTasks] = useState<Set<string>>(new Set());
  const [taskMessages, setTaskMessages] = useState<Record<string,string>>({});
  const [sorting, setSorting] = useState(false);
  const [draftOrder, setDraftOrder] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState('all');
  const { data: groupsData } = useQuery({ queryKey: ['taskGroups',user?.id], queryFn: api.getTaskGroups });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        title: form.title,
        description: form.description || undefined,
        points: form.points,
        isRecurring: form.isRecurring,
        recurringType: form.isRecurring ? form.recurringType : undefined,
        keepAfterCompletion: form.keepAfterCompletion,
        maxCompletions: form.maxCompletions ? Number(form.maxCompletions) : null,
        groupId: form.groupId || null,
      };
      if (editing) await api.updateTask(editing.id, payload);
      else await api.createTask(payload);
      setOpen(false);
      setEditing(null);
      setForm({
        title: '',
        description: '',
        points: 5,
        isRecurring: false,
        recurringType: 'daily',
        keepAfterCompletion: true,
        maxCompletions: '', groupId: '',
      });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    } catch (err) {
      alert(err instanceof Error ? err.message : '建立失敗');
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async (id: string) => {
    if (submitting.current.has(id)) return;
    submitting.current.add(id); setBusyTasks(new Set(submitting.current));
    setTaskMessages(m=>({...m,[id]:'送出中，請稍候…'}));
    const key=`task-request:${user?.id}:${id}:${data?.localDate}`;
    try {
      const requestId=taskRequestId(key);
      const {completion}=await api.completeTask(id,undefined,requestId);
      clearTaskRequestId(key);
      qc.setQueryData(['tasks',user?.id],(old:typeof data)=>old?({...old,tasks:old.tasks.map(t=>t.id===id?({...t,myStatus:completion.status==='APPROVED'?'APPROVED':completion.status==='PENDING'?'PENDING':'READY'}):t)}):old);
      setTaskMessages(m=>({...m,[id]:completion.status==='REJECTED'?'先前申請已退回，請重新提交。':completion.status==='APPROVED'?'今日已完成！':'已送出，等待家長審核。'}));
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['challenges'] });
    } catch (err) {
      try {
        const refreshed=await api.getTasks();
        qc.setQueryData(['tasks',user?.id],refreshed);
        const status=refreshed.tasks.find(t=>t.id===id)?.myStatus;
        if(status==='PENDING'||status==='APPROVED'){
          clearTaskRequestId(key);
          setTaskMessages(m=>({...m,[id]:status==='PENDING'?'已確認送出，等待家長審核。':'今日已完成。'}));
        } else setTaskMessages(m=>({...m,[id]:`${err instanceof Error?err.message:'未能送出'}；可按完成安全重試。`}));
      } catch {setTaskMessages(m=>({...m,[id]:'目前無法確認送出結果。網路恢復後可按完成安全重試，不會重複領星。'}));}
    } finally {
      submitting.current.delete(id);setBusyTasks(new Set(submitting.current));
    }
  };

  const startEdit = (task: Task) => {
    task = task.nextConfig ?? task;
    setEditing(task);
    setForm({ title: task.title, description: task.description ?? '', points: task.points, isRecurring: task.isRecurring, recurringType: task.recurringType === 'weekly' ? 'weekly' : 'daily', keepAfterCompletion: task.keepAfterCompletion, maxCompletions: task.maxCompletions?.toString() ?? '', groupId: task.groupId ?? '' });
    setOpen(true);
  };

  const tasks = (sorting
    ? draftOrder.map((id) => data?.tasks.find((task) => task.id === id)).filter((task): task is Task => Boolean(task))
    : (data?.tasks ?? [])).filter((task) => groupFilter === 'all' || groupFilter === 'ungrouped' ? (groupFilter === 'all' || !task.groupId) : task.groupId === groupFilter);

  const dropTask = (targetId: string) => { if (!draggingId || draggingId === targetId) return; const all = sorting ? [...draftOrder] : (data?.tasks ?? []).map((task) => task.id); const from=all.indexOf(draggingId), to=all.indexOf(targetId); all.splice(to,0,all.splice(from,1)[0]); setDraftOrder(all); setSorting(true); setDraggingId(null); };

  const moveTask = (index: number, direction: -1 | 1) => {
    const items = [...draftOrder]; const next = index + direction;
    if (next < 0 || next >= items.length) return;
    [items[index], items[next]] = [items[next], items[index]];
    setDraftOrder(items);
  };

  const saveOrder = async () => {
    try {
      await api.reorderTasks(draftOrder);
      setSorting(false);
      qc.invalidateQueries({ queryKey: ['tasks'] });
    } catch (err) { alert(err instanceof Error ? err.message : '排序失敗'); }
  };

  const handleDelete = async (task: Task) => {
    if (!confirm(`確定要刪除「${task.title}」嗎？已有完成紀錄時會改為停用，以保留歷史。`)) return;
    try { const result = await api.deleteTask(task.id); alert(result.archived ? '任務已停用，歷史紀錄已保留。' : '任務已刪除。'); qc.invalidateQueries({ queryKey: ['tasks'] }); }
    catch (err) { alert(err instanceof Error ? err.message : '刪除失敗'); }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-800">任務</h1>
      <DailyChallenges tasks={data?.tasks ?? []} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-extrabold text-slate-800">任務清單</h2>
        {isParent && (
          <div className="flex flex-wrap gap-2">
            <button onClick={async () => { const name=prompt('新增任務群組名稱'); if (!name?.trim()) return; try { await api.createTaskGroup(name.trim()); qc.invalidateQueries({queryKey:['taskGroups']}); } catch { alert('建立群組失敗，名稱可能重複'); } }} className="px-3 py-2 bg-slate-100 text-slate-600 font-bold rounded-xl text-sm">+ 群組</button>
            {sorting ? <><button onClick={() => { setSorting(false); setDraftOrder([]); }} className="px-3 py-2 bg-slate-100 text-slate-600 font-bold rounded-xl text-sm">取消排序</button><button onClick={saveOrder} className="px-3 py-2 bg-primary text-white font-bold rounded-xl text-sm">儲存排序</button></> : <button onClick={() => { setDraftOrder((data?.tasks ?? []).map((task) => task.id)); setSorting(true); }} className="px-3 py-2 bg-slate-100 text-slate-600 font-bold rounded-xl text-sm">排序</button>}
            <button onClick={() => window.print()} className="px-3 py-2 bg-slate-100 text-slate-600 font-bold rounded-xl text-sm print:hidden">列印</button>
            <button onClick={() => setOpen(true)} className="px-4 py-2 bg-primary text-white font-bold rounded-xl text-sm">+ 新增任務</button>
          </div>
        )}
      </div>

      {error ? <p role="alert">任務載入失敗，請重新整理。</p> : isLoading ? (
        <p className="text-slate-400">載入中...</p>
      ) : !data?.tasks?.length ? (
        <p className="text-slate-400">目前沒有任務</p>
      ) : (
        <>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setGroupFilter('all')} className={`px-3 py-1 rounded-full text-sm ${groupFilter==='all'?'bg-primary text-white':'bg-white text-slate-600'}`}>全部</button>
          {groupsData?.groups.map((g)=><button key={g.id} onClick={()=>setGroupFilter(g.id)} className={`px-3 py-1 rounded-full text-sm ${groupFilter===g.id?'bg-primary text-white':'bg-white text-slate-600'}`}>{g.name}</button>)}
          {data.tasks.some((task) => !task.groupId) && <button onClick={() => setGroupFilter('ungrouped')} className={`px-3 py-1 rounded-full text-sm ${groupFilter==='ungrouped'?'bg-primary text-white':'bg-white text-slate-600'}`}>未分組</button>}
        </div>
        <div className="space-y-3 print:grid print:grid-cols-2 print:gap-3 print:space-y-0">
          {tasks.map((task, index) => (
            <div key={task.id} draggable={isParent} onDragStart={()=>setDraggingId(task.id)} onDragOver={(e)=>e.preventDefault()} onDrop={()=>dropTask(task.id)} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex flex-wrap items-center justify-between gap-4 print:break-inside-avoid print:border-slate-300">
              <div className="min-w-0 max-w-full break-words">
                <div className="font-bold text-slate-800">{task.title}</div>
                {task.group && <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{task.group.name}</span>}
                {task.description && (
                  <p className="text-sm text-slate-500 mt-0.5">
                    {task.description}
                  </p>
                )}
                <div className="mt-1 flex items-center gap-2 text-sm">
                  <span className="text-accent font-bold">⭐ {task.points}</span>
                  {task.isRecurring && (
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      {task.recurringType === 'weekly' ? '每週' : '每日'}
                    </span>
                  )}
                </div>
              </div>
              {isParent ? (
                <div className="flex gap-3 text-sm font-bold shrink-0">
                  {sorting && <><button disabled={index === 0} onClick={() => moveTask(index, -1)} className="text-slate-500 disabled:opacity-30">↑</button><button disabled={index === tasks.length - 1} onClick={() => moveTask(index, 1)} className="text-slate-500 disabled:opacity-30">↓</button></>}
                  <button onClick={() => startEdit(task)} className="text-primary hover:underline">編輯</button>
                  <button onClick={() => handleDelete(task)} className="text-red-500 hover:underline">刪除</button>
                </div>
              ) : (
                <button
                  onClick={() => handleComplete(task.id)}
                  disabled={busyTasks.has(task.id)||task.myStatus==='PENDING'||task.myStatus==='APPROVED'}
                  aria-busy={busyTasks.has(task.id)}
                  className="min-h-11 px-4 py-2 bg-emerald-700 text-white font-bold rounded-xl text-sm shrink-0 disabled:bg-slate-200 disabled:text-slate-600"
                >
                  {busyTasks.has(task.id)?'送出中…':task.myStatus==='PENDING'?'等待家長審核':task.myStatus==='APPROVED'?'今日已完成':'完成'}
                </button>
              )}
              {taskMessages[task.id]&&<p role="status" className="w-full text-sm text-slate-600">{taskMessages[task.id]}</p>}
            </div>
          ))}
        </div>
        </>
      )}

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreate}
            className="bg-white rounded-2xl p-6 w-full max-w-sm max-h-[85dvh] overflow-y-auto space-y-4"
          >
            <h3 className="font-extrabold text-lg">{editing ? '編輯任務' : '新增任務'}</h3>
            {editing && (editing.isRecurring || form.isRecurring) && <p className="text-sm text-slate-600">每日任務的修改於家庭時區翌日生效，今日獎勵不受影響。</p>}
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
              placeholder="任務名稱"
              className="w-full px-3 py-2 rounded-xl border border-slate-200"
            />
            <select value={form.groupId} onChange={(e) => setForm((f) => ({ ...f, groupId: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-slate-200">
              <option value="">未分組</option>{groupsData?.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
            <input type="number" min={1} value={form.maxCompletions} onChange={(e) => setForm((f) => ({ ...f, maxCompletions: e.target.value }))} placeholder="完成次數上限（留空不限）" className="w-full px-3 py-2 rounded-xl border border-slate-200" />
            <input
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder="說明（選填）"
              className="w-full px-3 py-2 rounded-xl border border-slate-200"
            />
            <div>
              <label className="text-sm font-semibold text-slate-600">
                星星獎勵
              </label>
              <input
                type="number"
                min={0}
                value={form.points}
                onChange={(e) =>
                  setForm((f) => ({ ...f, points: Number(e.target.value) }))
                }
                className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isRecurring}
                onChange={(e) =>
                  setForm((f) => ({ ...f, isRecurring: e.target.checked }))
                }
              />
              重複任務
            </label>
            {form.isRecurring && (
              <select
                value={form.recurringType}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    recurringType: e.target.value as 'daily' | 'weekly',
                  }))
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-200"
              >
                <option value="daily">每日</option>
                <option value="weekly">每週</option>
              </select>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.keepAfterCompletion} onChange={(e) => setForm((f) => ({ ...f, keepAfterCompletion: e.target.checked }))} />
              核准完成後繼續保留此任務
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setOpen(false); setEditing(null); }}
                className="flex-1 py-2 rounded-xl bg-slate-100 font-semibold"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2 rounded-xl bg-primary text-white font-bold disabled:opacity-60"
              >
              {loading ? '儲存中...' : editing ? '儲存' : '建立'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
