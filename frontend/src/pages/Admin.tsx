import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Navigate } from 'react-router-dom';

export default function Admin() {
  const { user } = useAuth();
  const qc = useQueryClient();

  if (user?.role !== 'ADMIN') {
    return <Navigate to="/app" replace />;
  }

  const { data: usersData } = useQuery({
    queryKey: ['adminUsers'],
    queryFn: api.getUsers,
  });

  const { data: familiesData } = useQuery({
    queryKey: ['adminFamilies'],
    queryFn: api.getFamilies,
  });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-extrabold text-slate-800">管理後台</h1>

      <section>
        <h2 className="font-bold text-slate-700 mb-3">
          使用者（{usersData?.users?.length ?? 0}）
        </h2>
        <div className="space-y-2">
          {usersData?.users?.map((u) => (
            <div
              key={u.id}
              className="bg-white rounded-xl p-4 border border-slate-100 flex items-center justify-between"
            >
              <div>
                <span className="font-semibold">{u.name}</span>
                <span className="text-slate-400 text-sm ml-2">{u.email}</span>
                <span className="ml-2 text-xs bg-slate-100 px-2 py-0.5 rounded">
                  {u.role}
                </span>
              </div>
              {u.id !== user.id && (
                <div className="flex items-center gap-3">
                  <select
                    value={u.role}
                    onChange={async (e) => {
                      if (!confirm(`將 ${u.name} 設為 ${e.target.value}？`)) return;
                      try { await api.updateUserRole(u.id, e.target.value as typeof u.role); qc.invalidateQueries({ queryKey: ['adminUsers'] }); }
                      catch (err) { alert(err instanceof Error ? err.message : '角色更新失敗'); }
                    }}
                    className="text-xs border border-slate-200 rounded px-1 py-1"
                  >
                    <option value="ADMIN">ADMIN</option><option value="PARENT">PARENT</option><option value="CHILD">CHILD</option>
                  </select>
                  <button
                    onClick={async () => {
                      if (!confirm(`永久刪除 ${u.name} 的帳號？此操作無法復原。`)) return;
                      try { await api.deleteUser(u.id); qc.invalidateQueries({ queryKey: ['adminUsers'] }); qc.invalidateQueries({ queryKey: ['adminFamilies'] }); }
                      catch (err) { alert(err instanceof Error ? err.message : '刪除失敗'); }
                    }}
                    className="text-xs text-red-500 hover:underline"
                  >刪除帳號</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-bold text-slate-700 mb-3">
          家庭（{familiesData?.families?.length ?? 0}）
        </h2>
        <div className="space-y-2">
          {familiesData?.families?.map((f) => (
            <div
              key={f.id}
              className="bg-white rounded-xl p-4 border border-slate-100"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-semibold">{f.name}</div>
                  <div className="text-xs text-slate-400 mt-1">
                    邀請碼 {f.inviteCode} · 成員 {f.members?.length ?? 0}
                  </div>
                </div>
                <div className="flex gap-3 text-xs font-bold shrink-0">
                  <button onClick={async () => {
                    const name = prompt('新的家庭名稱', f.name);
                    if (!name?.trim()) return;
                    try { await api.updateFamily(f.id, name.trim()); qc.invalidateQueries({ queryKey: ['adminFamilies'] }); }
                    catch (err) { alert(err instanceof Error ? err.message : '更新失敗'); }
                  }} className="text-primary hover:underline">編輯</button>
                  <button onClick={async () => {
                    if (!confirm(`永久刪除家庭「${f.name}」？成員關聯、任務、獎勵與申請紀錄都會一併刪除。`)) return;
                    try { await api.deleteFamily(f.id); qc.invalidateQueries({ queryKey: ['adminFamilies'] }); qc.invalidateQueries({ queryKey: ['adminUsers'] }); }
                    catch (err) { alert(err instanceof Error ? err.message : '刪除失敗'); }
                  }} className="text-red-500 hover:underline">刪除家庭</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
