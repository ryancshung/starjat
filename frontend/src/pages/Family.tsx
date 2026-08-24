import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useState } from 'react';

export default function FamilyPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isParent = user?.role === 'PARENT' || user?.role === 'ADMIN';

  const { data, isLoading } = useQuery({
    queryKey: ['family'],
    queryFn: api.getMyFamily,
  });

  const [copied, setCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState('');
  const family = data?.family;

  const copyCode = () => {
    if (!family) return;
    navigator.clipboard.writeText(family.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) return <p className="text-slate-400">載入中...</p>;
  if (!family) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-500">尚未加入家庭</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          {editingName ? (
            <input value={name} onChange={(e) => setName(e.target.value)} className="px-3 py-1 rounded-lg border border-slate-200 font-bold" />
          ) : <h1 className="text-2xl font-extrabold text-slate-800">{family.name}</h1>}
          {isParent && (
            <button
              onClick={async () => {
                if (!editingName) { setName(family.name); setEditingName(true); return; }
                if (!name.trim()) return;
                try { await api.updateMyFamily(name.trim()); qc.invalidateQueries({ queryKey: ['family'] }); setEditingName(false); }
                catch (err) { alert(err instanceof Error ? err.message : '更新失敗'); }
              }}
              className="text-sm text-primary font-bold hover:underline"
            >
              {editingName ? '儲存' : '編輯名稱'}
            </button>
          )}
          {editingName && <button onClick={() => setEditingName(false)} className="text-sm text-slate-500">取消</button>}
        </div>
        <p className="text-slate-500 text-sm mt-1">家庭成員管理</p>
      </div>

      {isParent && (
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <div className="text-sm font-semibold text-slate-600 mb-2">
            邀請碼（給孩子註冊用）
          </div>
          <div className="flex items-center gap-3">
            <span className="text-3xl font-mono font-extrabold tracking-[0.25em] text-primary whitespace-nowrap">
              {family.inviteCode}
            </span>
            <button
              onClick={copyCode}
              className="px-3 py-1.5 bg-primary/10 text-primary font-bold rounded-lg text-sm"
            >
              {copied ? '已複製！' : '複製'}
            </button>
          </div>
        </div>
      )}

      <div>
        <h2 className="font-bold text-slate-700 mb-3">
          成員（{family.members.length}）
        </h2>
        <div className="space-y-2">
          {family.members.map(({ user: m }) => (
            <div
              key={m.id}
              className="bg-white rounded-xl p-4 border border-slate-100 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center font-bold text-primary">
                  {m.name[0]}
                </div>
                <div>
                  <div className="font-semibold text-slate-800">
                    {m.name}
                    {m.id === user?.id && (
                      <span className="ml-1 text-xs text-slate-400">（你）</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400">
                    {m.role === 'ADMIN'
                      ? '管理員'
                      : m.role === 'PARENT'
                        ? '家長'
                        : '孩子'}{' '}
                    · ⭐ {m.points}
                  </div>
                </div>
              </div>
              {isParent && m.id !== user?.id && m.role === 'CHILD' && (
                <button
                  onClick={async () => {
                    if (!confirm(`確定要移除 ${m.name} 嗎？`)) return;
                    await api.removeMember(m.id);
                    qc.invalidateQueries({ queryKey: ['family'] });
                  }}
                  className="text-xs text-red-500 hover:underline"
                >
                  移除
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
