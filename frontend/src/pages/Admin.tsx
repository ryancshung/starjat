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
                <button
                  onClick={async () => {
                    if (!confirm(`刪除 ${u.name}？`)) return;
                    await api.deleteUser(u.id);
                    qc.invalidateQueries({ queryKey: ['adminUsers'] });
                  }}
                  className="text-xs text-red-500 hover:underline"
                >
                  刪除
                </button>
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
              <div className="font-semibold">{f.name}</div>
              <div className="text-xs text-slate-400 mt-1">
                邀請碼 {f.inviteCode} · 成員{' '}
                {f.members?.length ?? 0}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
