import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, Task } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Tasks() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isParent = user?.role === 'PARENT' || user?.role === 'ADMIN';

  const { data, isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: api.getTasks,
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
  });
  const [loading, setLoading] = useState(false);

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
      });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    } catch (err) {
      alert(err instanceof Error ? err.message : '建立失敗');
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async (id: string) => {
    try {
      await api.completeTask(id);
      alert('已提交，等待家長審核！');
      qc.invalidateQueries({ queryKey: ['tasks'] });
    } catch (err) {
      alert(err instanceof Error ? err.message : '提交失敗');
    }
  };

  const startEdit = (task: Task) => {
    setEditing(task);
    setForm({ title: task.title, description: task.description ?? '', points: task.points, isRecurring: task.isRecurring, recurringType: task.recurringType === 'weekly' ? 'weekly' : 'daily', keepAfterCompletion: task.keepAfterCompletion });
    setOpen(true);
  };

  const moveTask = async (index: number, direction: -1 | 1) => {
    const items = [...(data?.tasks ?? [])]; const next = index + direction;
    if (next < 0 || next >= items.length) return;
    [items[index], items[next]] = [items[next], items[index]];
    try { await api.reorderTasks(items.map((task) => task.id)); qc.invalidateQueries({ queryKey: ['tasks'] }); }
    catch (err) { alert(err instanceof Error ? err.message : '排序失敗'); }
  };

  const handleDelete = async (task: Task) => {
    if (!confirm(`確定要刪除「${task.title}」嗎？已有完成紀錄時會改為停用，以保留歷史。`)) return;
    try { const result = await api.deleteTask(task.id); alert(result.archived ? '任務已停用，歷史紀錄已保留。' : '任務已刪除。'); qc.invalidateQueries({ queryKey: ['tasks'] }); }
    catch (err) { alert(err instanceof Error ? err.message : '刪除失敗'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-slate-800">任務</h1>
        {isParent && (
          <button
            onClick={() => setOpen(true)}
            className="px-4 py-2 bg-primary text-white font-bold rounded-xl text-sm"
          >
            + 新增任務
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-slate-400">載入中...</p>
      ) : !data?.tasks?.length ? (
        <p className="text-slate-400">目前沒有任務</p>
      ) : (
        <div className="space-y-3">
          {data.tasks.map((task, index) => (
            <div key={task.id} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex items-center justify-between gap-4">
              <div>
                <div className="font-bold text-slate-800">{task.title}</div>
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
                  <button disabled={index === 0} onClick={() => moveTask(index, -1)} className="text-slate-500 disabled:opacity-30">↑</button>
                  <button disabled={index === data.tasks.length - 1} onClick={() => moveTask(index, 1)} className="text-slate-500 disabled:opacity-30">↓</button>
                  <button onClick={() => startEdit(task)} className="text-primary hover:underline">編輯</button>
                  <button onClick={() => handleDelete(task)} className="text-red-500 hover:underline">刪除</button>
                </div>
              ) : (
                <button
                  onClick={() => handleComplete(task.id)}
                  className="px-4 py-2 bg-secondary text-white font-bold rounded-xl text-sm shrink-0"
                >
                  完成
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreate}
            className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4"
          >
            <h3 className="font-extrabold text-lg">{editing ? '編輯任務' : '新增任務'}</h3>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
              placeholder="任務名稱"
              className="w-full px-3 py-2 rounded-xl border border-slate-200"
            />
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
                min={1}
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
