import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const typeLabels = { EARN: '獲得', SPEND: '兌換', DEDUCT: '扣星', REVERSAL: '扣星更正', ADJUST: '調整' };

export default function History() {
  const { user } = useAuth();
  const isParent = user?.role === 'PARENT' || user?.role === 'ADMIN';
  const qc = useQueryClient();
  const { data: familyData } = useQuery({ queryKey: ['family'], queryFn: api.getMyFamily, enabled: isParent });
  const children = familyData?.family?.members.filter((member) => member.user.role === 'CHILD') ?? [];
  const [selectedUserId, setSelectedUserId] = useState('');
  useEffect(() => { if (isParent && !selectedUserId && children[0]) setSelectedUserId(children[0].user.id); }, [children, isParent, selectedUserId]);
  const targetUserId = isParent ? selectedUserId || undefined : undefined;
  const { data, isLoading } = useQuery({ queryKey: ['pointHistory', targetUserId], queryFn: () => api.getPointHistory(targetUserId), enabled: !isParent || Boolean(targetUserId) });
  const reversedIds = new Set(data?.transactions.filter((item) => item.reversalOfId).map((item) => item.reversalOfId));
  const isOwner = familyData?.family?.ownerId === user?.id;

  return <div className="space-y-6"><header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-extrabold text-slate-800">星星紀錄</h1><p className="mt-1 text-sm text-slate-500">所有扣星與更正都會永久保留。</p></div>{isParent && <label className="text-sm font-bold text-slate-700">查看孩子<select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)} className="ml-2 rounded-xl border border-slate-200 px-3 py-2 font-normal"><option value="">選擇孩子</option>{children.map((member) => <option key={member.user.id} value={member.user.id}>{member.user.name}</option>)}</select></label>}</header>{isLoading ? <p role="status" className="text-slate-500">載入中...</p> : !data?.transactions.length ? <p className="text-slate-500">目前沒有紀錄</p> : <div className="space-y-2">{data.transactions.map((transaction) => <article key={transaction.id} className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className="font-bold text-slate-800">{transaction.reason}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{typeLabels[transaction.type]}</span></div><div className="mt-1 text-xs text-slate-500">{new Date(transaction.createdAt).toLocaleString('zh-TW')}{transaction.balanceBefore != null && transaction.balanceAfter != null ? ` · ⭐ ${transaction.balanceBefore} → ${transaction.balanceAfter}` : ''}</div></div><div className="flex items-center gap-3"><span className={`text-lg font-extrabold ${transaction.amount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{transaction.amount > 0 ? '+' : ''}{transaction.amount}</span>{isOwner && transaction.type === 'DEDUCT' && !reversedIds.has(transaction.id) && <button type="button" onClick={async () => { const reason = window.prompt('請填寫補回星星的更正原因'); if (!reason) return; await api.reverseDeduction(transaction.id, reason); qc.invalidateQueries({ queryKey: ['pointHistory', targetUserId] }); qc.invalidateQueries({ queryKey: ['family'] }); }} className="text-sm font-bold text-primary">補回</button>}{reversedIds.has(transaction.id) && <span className="text-xs font-bold text-slate-400">已更正</span>}</div></article>)}</div>}</div>;
}
