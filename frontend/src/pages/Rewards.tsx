import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, Reward } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Rewards() {
  const { user, refreshUser } = useAuth();
  const qc = useQueryClient();
  const isParent = user?.role === 'PARENT' || user?.role === 'ADMIN';

  const { data, isLoading } = useQuery({
    queryKey: ['rewards'],
    queryFn: api.getRewards,
  });

  const { data: balanceData } = useQuery({
    queryKey: ['balance'],
    queryFn: api.getBalance,
    enabled: !isParent,
    refetchInterval: 3000,
  });
  const livePoints = balanceData?.points ?? user?.points ?? 0;

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Reward | null>(null);
  const [form, setForm] = useState({ title: '', description: '', cost: 10, keepAfterRedemption: true, maxRedemptions: '', discountPercent: '', discountStart: '', discountEnd: '' });
  const [loading, setLoading] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [draftOrder, setDraftOrder] = useState<string[]>([]);
  const [wishTitle, setWishTitle] = useState('');
  const [discountOpen, setDiscountOpen] = useState(false);
  const [globalDiscount, setGlobalDiscount] = useState({ percent: '', start: '', end: '' });
  const { data: wishesData } = useQuery({ queryKey: ['wishes'], queryFn: api.getWishes });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        title: form.title,
        description: form.description || undefined,
        cost: form.cost,
        keepAfterRedemption: form.keepAfterRedemption,
        maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
        discountPercent: form.discountPercent ? Number(form.discountPercent) : null,
        discountStart: form.discountStart ? new Date(form.discountStart).toISOString() : null,
        discountEnd: form.discountEnd ? new Date(form.discountEnd).toISOString() : null,
      };
      if (editing) await api.updateReward(editing.id, payload);
      else await api.createReward(payload);
      setOpen(false);
      setEditing(null);
      setForm({ title: '', description: '', cost: 10, keepAfterRedemption: true, maxRedemptions: '', discountPercent: '', discountStart: '', discountEnd: '' });
      qc.invalidateQueries({ queryKey: ['rewards'] });
    } catch (err) {
      alert(err instanceof Error ? err.message : '建立失敗');
    } finally {
      setLoading(false);
    }
  };

  const handleRedeem = async (id: string, cost: number) => {
    if (livePoints < cost) {
      alert('星星不夠哦！');
      return;
    }
    if (!confirm('確定要申請兌換嗎？需家長審核。')) return;
    try {
      await api.redeemReward(id);
      alert('已送出兌換申請！');
      await refreshUser();
    } catch (err) {
      alert(err instanceof Error ? err.message : '兌換失敗');
    }
  };

  const startEdit = (reward: Reward) => {
    setEditing(reward);
    setForm({ title: reward.title, description: reward.description ?? '', cost: reward.cost, keepAfterRedemption: reward.keepAfterRedemption, maxRedemptions: reward.maxRedemptions?.toString() ?? '', discountPercent: reward.discountPercent?.toString() ?? '', discountStart: reward.discountStart ? reward.discountStart.slice(0, 16) : '', discountEnd: reward.discountEnd ? reward.discountEnd.slice(0, 16) : '' });
    setOpen(true);
  };

  const rewards = sorting
    ? draftOrder.map((id) => data?.rewards.find((reward) => reward.id === id)).filter((reward): reward is Reward => Boolean(reward))
    : (data?.rewards ?? []);

  const moveReward = (index: number, direction: -1 | 1) => {
    const items = [...draftOrder]; const next = index + direction;
    if (next < 0 || next >= items.length) return;
    [items[index], items[next]] = [items[next], items[index]];
    setDraftOrder(items);
  };

  const saveOrder = async () => {
    try {
      await api.reorderRewards(draftOrder);
      setSorting(false);
      qc.invalidateQueries({ queryKey: ['rewards'] });
    } catch (err) { alert(err instanceof Error ? err.message : '排序失敗'); }
  };

  const handleDelete = async (reward: Reward) => {
    if (!confirm(`確定要刪除「${reward.title}」嗎？已有兌換紀錄時會改為停用，以保留歷史。`)) return;
    try { const result = await api.deleteReward(reward.id); alert(result.archived ? '獎勵已停用，歷史紀錄已保留。' : '獎勵已刪除。'); qc.invalidateQueries({ queryKey: ['rewards'] }); }
    catch (err) { alert(err instanceof Error ? err.message : '刪除失敗'); }
  };
  const discountActive = (reward: Reward) => Boolean(reward.discountPercent && (!reward.discountStart || new Date(reward.discountStart) <= new Date()) && (!reward.discountEnd || new Date(reward.discountEnd) >= new Date()));
  const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '長期有效';
  const applyAllDiscount = async () => { try { await api.setAllRewardDiscounts(globalDiscount.percent ? Number(globalDiscount.percent) : null, globalDiscount.start ? new Date(globalDiscount.start).toISOString() : null, globalDiscount.end ? new Date(globalDiscount.end).toISOString() : null); setDiscountOpen(false); qc.invalidateQueries({ queryKey: ['rewards'] }); } catch (err) { alert(err instanceof Error ? err.message : '設定失敗'); } };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">獎勵</h1>
          {!isParent && (
            <p className="text-sm text-slate-500">
              你有 ⭐ {livePoints} 星星
            </p>
          )}
        </div>
        {isParent && (
          <div className="flex gap-2">
            <button onClick={()=>setDiscountOpen(true)} className="px-3 py-2 bg-amber-100 text-amber-800 font-bold rounded-xl text-sm">折扣管理</button>
            {sorting ? <><button onClick={() => { setSorting(false); setDraftOrder([]); }} className="px-3 py-2 bg-slate-100 text-slate-600 font-bold rounded-xl text-sm">取消排序</button><button onClick={saveOrder} className="px-3 py-2 bg-secondary text-white font-bold rounded-xl text-sm">儲存排序</button></> : <button onClick={() => { setDraftOrder((data?.rewards ?? []).map((reward) => reward.id)); setSorting(true); }} className="px-3 py-2 bg-slate-100 text-slate-600 font-bold rounded-xl text-sm">排序</button>}
            <button onClick={() => setOpen(true)} className="px-4 py-2 bg-secondary text-white font-bold rounded-xl text-sm">+ 新增獎勵</button>
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="text-slate-400">載入中...</p>
      ) : !data?.rewards?.length ? (
        <p className="text-slate-400">目前沒有獎勵</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {rewards.map((reward, index) => (
            <div
              key={reward.id}
              className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm"
            >
              <div className="font-bold text-slate-800 text-lg">
                {reward.title}
              </div>
              {reward.description && (
                <p className="text-sm text-slate-500 mt-1">
                  {reward.description}
                </p>
              )}
              {discountActive(reward) && <div className="mt-2 inline-flex rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600">🏷️ {reward.discountPercent}% 折扣 · {reward.discountEnd ? `到 ${formatDate(reward.discountEnd)}` : '長期有效'}</div>}
              <div className="mt-3 flex items-center justify-between">
                <span className="text-accent font-extrabold">
                  {discountActive(reward) ? <><span className="text-slate-400 line-through mr-1">⭐ {reward.cost}</span> ⭐ {Math.ceil(reward.cost * (100 - (reward.discountPercent ?? 0)) / 100)} <span className="text-xs text-red-500">-{reward.discountPercent}%</span></> : <>⭐ {reward.cost}</>}
                </span>
                {isParent ? (
                  <div className="flex gap-3 text-sm font-bold">
                    {sorting && <><button disabled={index === 0} onClick={() => moveReward(index, -1)} className="text-slate-500 disabled:opacity-30">↑</button><button disabled={index === rewards.length - 1} onClick={() => moveReward(index, 1)} className="text-slate-500 disabled:opacity-30">↓</button></>}
                    <button onClick={() => startEdit(reward)} className="text-primary hover:underline">編輯</button>
                    <button onClick={() => handleDelete(reward)} className="text-red-500 hover:underline">刪除</button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleRedeem(reward.id, reward.cost)}
                    className="px-4 py-1.5 bg-primary text-white font-bold rounded-xl text-sm"
                  >
                    兌換
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm space-y-3">
        <h2 className="font-bold text-slate-700">✨ 許願區</h2>
        {!isParent && <form onSubmit={async e=>{e.preventDefault();if(!wishTitle.trim())return;try{await api.createWish(wishTitle.trim());setWishTitle('');qc.invalidateQueries({queryKey:['wishes']});alert('願望已送出給家長！')}catch(err){alert(err instanceof Error?err.message:'送出失敗')}}} className="flex gap-2"><input value={wishTitle} onChange={e=>setWishTitle(e.target.value)} placeholder="我想要的獎勵..." className="flex-1 px-3 py-2 rounded-xl border border-slate-200"/><button className="px-4 py-2 bg-primary text-white font-bold rounded-xl">許願</button></form>}
        {wishesData?.wishes.map(w=><div key={w.id} className="flex justify-between text-sm border-t pt-2"><span>{w.title} {isParent&&<span className="text-slate-400">· {w.user.name}</span>}</span>{isParent&&w.status==='PENDING'?<div className="flex gap-2"><button onClick={async()=>{const v=prompt('核准後所需星星數');const cost=Number(v);if(!cost)return;await api.reviewWish(w.id,'APPROVED',cost);qc.invalidateQueries({queryKey:['wishes']});qc.invalidateQueries({queryKey:['rewards']})}} className="text-primary font-bold">核准</button><button onClick={async()=>{await api.reviewWish(w.id,'REJECTED');qc.invalidateQueries({queryKey:['wishes']})}} className="text-red-500">婉拒</button></div>:<span className="text-slate-400">{w.status==='PENDING'?'等待家長確認':w.status==='APPROVED'?'已加入獎勵':'未核准'}</span>}</div>)}
      </section>

      {discountOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"><div><h2 className="text-lg font-extrabold">折扣管理</h2><p className="text-sm text-slate-500">可逐一點「編輯」管理個別折扣；以下設定會覆蓋所有獎勵的折扣與期間。</p></div><div className="rounded-xl bg-amber-50 p-4 space-y-3"><label className="block text-sm font-bold text-amber-900">全部套用折扣</label><input type="number" min={1} max={99} value={globalDiscount.percent} onChange={e=>setGlobalDiscount(v=>({...v,percent:e.target.value}))} placeholder="折扣 %（留空後儲存 = 全部取消）" className="w-full rounded-xl border border-amber-200 px-3 py-2"/><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-600">開始時間（留空立即開始）<input type="datetime-local" value={globalDiscount.start} onChange={e=>setGlobalDiscount(v=>({...v,start:e.target.value}))} className="mt-1 w-full rounded-xl border border-amber-200 px-3 py-2"/></label><label className="text-xs text-slate-600">到期時間（留空長期有效）<input type="datetime-local" value={globalDiscount.end} onChange={e=>setGlobalDiscount(v=>({...v,end:e.target.value}))} className="mt-1 w-full rounded-xl border border-amber-200 px-3 py-2"/></label></div></div><div className="flex gap-2"><button onClick={()=>setDiscountOpen(false)} className="flex-1 rounded-xl bg-slate-100 py-2 font-bold">取消</button><button onClick={applyAllDiscount} className="flex-1 rounded-xl bg-amber-500 py-2 font-bold text-white">套用到全部</button></div></div></div>}

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreate}
            className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4"
          >
            <h3 className="font-extrabold text-lg">{editing ? '編輯獎勵' : '新增獎勵'}</h3>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
              placeholder="獎勵名稱"
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
                所需星星
              </label>
              <input
                type="number"
                min={1}
                value={form.cost}
                onChange={(e) =>
                  setForm((f) => ({ ...f, cost: Number(e.target.value) }))
                }
                className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.keepAfterRedemption} onChange={(e) => setForm((f) => ({ ...f, keepAfterRedemption: e.target.checked }))} />
              核准兌換後繼續保留此獎勵
            </label>
            <input type="number" min={1} value={form.maxRedemptions} onChange={(e) => setForm((f) => ({ ...f, maxRedemptions: e.target.value }))} placeholder="兌換次數上限（留空不限）" className="w-full px-3 py-2 rounded-xl border border-slate-200" />
            <div className="rounded-xl bg-amber-50 p-3 space-y-2"><div className="flex items-center justify-between text-sm font-bold text-amber-800"><span>折扣設定</span><button type="button" onClick={()=>setForm(f=>({...f,discountPercent:'',discountStart:'',discountEnd:''}))} className="text-xs text-red-500">取消此折扣</button></div><input type="number" min={1} max={99} value={form.discountPercent} onChange={e=>setForm(f=>({...f,discountPercent:e.target.value}))} placeholder="折扣百分比，例如 20" className="w-full px-3 py-2 rounded-xl border border-amber-200" /><div className="grid grid-cols-2 gap-2"><label className="text-xs text-slate-600">開始時間（留空立即）<input type="datetime-local" value={form.discountStart} onChange={e=>setForm(f=>({...f,discountStart:e.target.value}))} className="mt-1 w-full px-2 py-2 rounded-xl border border-amber-200" /></label><label className="text-xs text-slate-600">到期時間（留空長期）<input type="datetime-local" value={form.discountEnd} onChange={e=>setForm(f=>({...f,discountEnd:e.target.value}))} className="mt-1 w-full px-2 py-2 rounded-xl border border-amber-200" /></label></div></div>
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
                className="flex-1 py-2 rounded-xl bg-secondary text-white font-bold disabled:opacity-60"
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
