import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Copy, Settings2, ShieldCheck } from 'lucide-react';
import { api, Family } from '../lib/api';
import { useAuth } from '../lib/auth';

const warning = '扣除星星可能讓孩子感到挫折。請確認每次扣除符合事前約定，並填寫孩子能理解的明確原因。扣星原因、時間與執行者都會永久保留，孩子也可以查看。';

function MemberSettings({ family, member, isOwner }: { family: Family; member: Family['members'][number]; isOwner: boolean }) {
  const qc = useQueryClient();
  const [limit, setLimit] = useState(member.monthlyAllowanceLimitTwd?.toString() ?? '');
  const isParent = member.user.role === 'PARENT' || member.user.role === 'ADMIN';
  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      {isParent && member.user.id !== family.ownerId && (
        <label className="flex items-start justify-between gap-4 text-sm">
          <span><span className="font-bold text-slate-700">允許扣星</span><span className="mt-0.5 block text-xs text-slate-500">每次操作仍會顯示警語及二次確認。</span></span>
          <input
            type="checkbox"
            checked={member.canDeductPoints}
            onChange={async (event) => {
              const next = event.target.checked;
              if (next && !window.confirm(`${warning}\n\n確定要開啟 ${member.user.name} 的扣星權限嗎？`)) return;
              await api.updateMemberSettings(member.user.id, { canDeductPoints: next });
              qc.invalidateQueries({ queryKey: ['family'] });
            }}
            className="mt-1 h-5 w-5 accent-primary"
            aria-label={`允許 ${member.user.name} 扣星`}
          />
        </label>
      )}
      {member.user.role === 'CHILD' && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm font-bold text-slate-700">每月零用錢上限（NT$）
            <input type="number" min={1} value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="留空表示不限" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal" />
          </label>
          <button type="button" onClick={async () => { await api.updateMemberSettings(member.user.id, { monthlyAllowanceLimitTwd: limit ? Number(limit) : null }); qc.invalidateQueries({ queryKey: ['family'] }); }} className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-bold text-white">儲存上限</button>
        </div>
      )}
      {isParent && member.user.id === family.ownerId && <p className="text-xs font-bold text-primary"><ShieldCheck className="mr-1 inline" size={14} />家庭管理者永遠具有扣星權限</p>}
      {!isOwner && <span className="sr-only">只有家庭管理者可以修改這些設定</span>}
    </div>
  );
}

export default function FamilyPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['family'], queryFn: api.getMyFamily });
  const family = data?.family;
  const isOwner = family?.ownerId === user?.id;
  const [copied, setCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Taipei');
  const [ratio, setRatio] = useState('');
  useEffect(() => { if (family) { setTimezone(family.timezone || 'Asia/Taipei'); setRatio(family.pointsPerTwd?.toString() ?? ''); } }, [family]);

  if (isLoading) return <p className="text-slate-500" role="status">載入中...</p>;
  if (!family) return <div className="py-12 text-center text-slate-500">尚未加入家庭</div>;

  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          {editingName ? <input value={name} onChange={(event) => setName(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-1 text-xl font-bold" aria-label="家庭名稱" /> : <h1 className="text-2xl font-extrabold text-slate-800">{family.name}</h1>}
          {isOwner && <button type="button" onClick={async () => { if (!editingName) { setName(family.name); setEditingName(true); return; } if (!name.trim()) return; await api.updateMyFamily(name.trim()); qc.invalidateQueries({ queryKey: ['family'] }); setEditingName(false); }} className="text-sm font-bold text-primary">{editingName ? '儲存' : '編輯名稱'}</button>}
          {editingName && <button type="button" onClick={() => setEditingName(false)} className="text-sm text-slate-500">取消</button>}
        </div>
        <p className="mt-1 text-sm text-slate-500">家庭成員、時區與權限管理</p>
      </header>

      {isOwner && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="family-settings-title">
          <div className="mb-4 flex items-center gap-2"><Settings2 className="text-primary" size={20} /><h2 id="family-settings-title" className="font-extrabold">家庭設定</h2></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-bold text-slate-700">家庭時區
              <input list="timezones" value={timezone} onChange={(event) => setTimezone(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal" />
              <datalist id="timezones"><option value="Asia/Taipei" /><option value="Asia/Tokyo" /><option value="America/Los_Angeles" /><option value="Europe/London" /></datalist>
            </label>
            <label className="text-sm font-bold text-slate-700">零用錢比例
              <div className="mt-1 flex items-center gap-2"><input type="number" min={1} value={ratio} onChange={(event) => setRatio(event.target.value)} placeholder="未啟用" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 font-normal" /><span className="whitespace-nowrap text-sm text-slate-500">星 = NT$1</span></div>
            </label>
          </div>
          <button type="button" onClick={async () => { await api.updateFamilySettings({ timezone, pointsPerTwd: ratio ? Number(ratio) : null }); qc.invalidateQueries({ queryKey: ['family'] }); }} className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white">儲存家庭設定</button>
        </section>
      )}

      {isOwner && (
        <section className="rounded-2xl border border-blue-100 bg-blue-50 p-5">
          <div className="text-sm font-bold text-slate-700">邀請碼</div>
          <div className="mt-2 flex flex-wrap items-center gap-3"><span className="font-mono text-3xl font-extrabold tracking-[0.2em] text-primary">{family.inviteCode}</span><button type="button" onClick={async () => { await navigator.clipboard.writeText(family.inviteCode); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-sm font-bold text-primary"><Copy size={15} />{copied ? '已複製' : '複製'}</button></div>
        </section>
      )}

      <section aria-labelledby="members-title">
        <h2 id="members-title" className="mb-3 font-bold text-slate-700">成員（{family.members.length}）</h2>
        <div className="space-y-3">
          {family.members.map((member) => (
            <article key={member.user.id} className="rounded-2xl border border-slate-100 bg-white p-4">
              <div className="flex items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 font-bold text-primary">{member.user.name[0]}</div><div><div className="font-bold text-slate-800">{member.user.name}{member.user.id === user?.id && <span className="ml-1 text-xs font-normal text-slate-400">（你）</span>}</div><div className="text-xs text-slate-500">{member.user.id === family.ownerId ? '家庭管理者' : member.user.role === 'CHILD' ? '孩子' : '家長'} · ⭐ {member.user.points}</div></div></div>{isOwner && member.user.id !== user?.id && <button type="button" onClick={async () => { if (!window.confirm(`確定要移除 ${member.user.name} 嗎？`)) return; await api.removeMember(member.user.id); qc.invalidateQueries({ queryKey: ['family'] }); }} className="text-xs font-bold text-red-600">移除</button>}</div>
              {isOwner && <MemberSettings family={family} member={member} isOwner={isOwner} />}
            </article>
          ))}
        </div>
      </section>

      {isOwner && <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertTriangle className="mt-0.5 shrink-0" size={18} /><p>扣星權限只決定家長是否能開始操作；每一次扣星仍會強制顯示警語與確認內容。</p></div>}
    </div>
  );
}
