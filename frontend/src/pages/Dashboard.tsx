import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import StarJar from '../components/StarJar';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

export default function Dashboard() {
  const { user, refreshUser } = useAuth();
  const qc = useQueryClient();
  const isParent = user?.role === 'PARENT' || user?.role === 'ADMIN';

  // 進入頁面與視窗重新聚焦時，重新抓取使用者積分
  useEffect(() => {
    refreshUser();
    const onFocus = () => {
      refreshUser();
      qc.invalidateQueries({ queryKey: ['family'] });
      qc.invalidateQueries({ queryKey: ['balance'] });
      qc.invalidateQueries({ queryKey: ['pendingTasks'] });
      qc.invalidateQueries({ queryKey: ['pendingRedemptions'] });
      qc.invalidateQueries({ queryKey: ['pendingAllowance'] });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshUser, qc]);

  const { data: familyData, refetch: refetchFamily } = useQuery({
    queryKey: ['family'],
    queryFn: api.getMyFamily,
    refetchInterval: isParent ? 5000 : false, // 家長每 5 秒刷新一次
  });

  // 孩子端即時積分
  const { data: balanceData } = useQuery({
    queryKey: ['balance'],
    queryFn: api.getBalance,
    enabled: !isParent,
    refetchInterval: 3000, // 孩子每 3 秒刷新積分
  });

  const { data: pendingTasks } = useQuery({
    queryKey: ['pendingTasks'],
    queryFn: api.getPendingTasks,
    enabled: isParent,
    refetchInterval: 5000,
  });

  const { data: pendingRedemptions } = useQuery({
    queryKey: ['pendingRedemptions'],
    queryFn: api.getPendingRedemptions,
    enabled: isParent,
    refetchInterval: 5000,
  });

  const { data: pendingAllowance } = useQuery({
    queryKey: ['pendingAllowance'],
    queryFn: api.getPendingAllowance,
    enabled: isParent,
    refetchInterval: 5000,
  });

  const family = familyData?.family;
  const kids =
    family?.members.filter((m) => m.user.role === 'CHILD') ?? [];
  const myMembership = family?.members.find((m) => m.user.id === user?.id);
  const canDeduct = family?.ownerId === user?.id || Boolean(myMembership?.canDeductPoints);

  const childPoints = balanceData?.points ?? user?.points ?? 0;

  // Award dialog
  const [awardOpen, setAwardOpen] = useState(false);
  const [awardForm, setAwardForm] = useState({
    userId: '',
    amount: 5,
    reason: '',
  });
  const [awardLoading, setAwardLoading] = useState(false);
  const [deductOpen, setDeductOpen] = useState(false);
  const [deductLoading, setDeductLoading] = useState(false);
  const [deductConfirmed, setDeductConfirmed] = useState(false);
  const [deductForm, setDeductForm] = useState({ userId: '', amount: 1, reason: '' });

  const handleAward = async (e: React.FormEvent) => {
    e.preventDefault();
    setAwardLoading(true);
    try {
      await api.awardPoints(
        awardForm.userId,
        awardForm.amount,
        awardForm.reason
      );
      setAwardOpen(false);
      setAwardForm({ userId: '', amount: 5, reason: '' });
      await refetchFamily();
      await refreshUser();
    } catch (err) {
      alert(err instanceof Error ? err.message : '發放失敗');
    } finally {
      setAwardLoading(false);
    }
  };

  const handleDeduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deductConfirmed) return;
    setDeductLoading(true);
    try {
      await api.deductPoints(deductForm.userId, deductForm.amount, deductForm.reason);
      setDeductOpen(false);
      setDeductConfirmed(false);
      setDeductForm({ userId: '', amount: 1, reason: '' });
      await refetchFamily();
    } catch (err) { alert(err instanceof Error ? err.message : '扣星失敗'); }
    finally { setDeductLoading(false); }
  };

  if (!family && isParent) {
    return (
      <div className="text-center py-16">
        <p className="text-slate-500 mb-4">你還沒有家庭</p>
        <Link
          to="/onboarding"
          className="px-6 py-2.5 bg-primary text-white font-bold rounded-xl"
        >
          建立家庭
        </Link>
      </div>
    );
  }

  // Child view
  if (!isParent) {
    return (
      <div className="space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-extrabold text-slate-800">
            嗨，{user?.name}！
          </h1>
          <p className="text-slate-500">繼續收集星星吧</p>
        </div>
        <div className="flex justify-center">
          <StarJar points={childPoints} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Link
            to="/app/tasks"
            className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm text-center hover:border-primary/30 transition"
          >
            <div className="text-2xl mb-1">✅</div>
            <div className="font-bold text-slate-700">我的任務</div>
          </Link>
          <Link
            to="/app/rewards"
            className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm text-center hover:border-primary/30 transition"
          >
            <div className="text-2xl mb-1">🎁</div>
            <div className="font-bold text-slate-700">兌換獎勵</div>
          </Link>
          <Link to="/app/trophies" className="rounded-2xl border border-slate-100 bg-white p-5 text-center shadow-sm transition hover:border-primary/30"><div className="text-2xl mb-1">🏆</div><div className="font-bold text-slate-700">獎盃展示櫃</div></Link>
          <Link to="/app/scheduled-awards" className="rounded-2xl border border-slate-100 bg-white p-5 text-center shadow-sm transition hover:border-primary/30"><div className="text-2xl mb-1">💵</div><div className="font-bold text-slate-700">零用錢</div></Link>
        </div>
      </div>
    );
  }

  // Parent view
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">
            {family?.name}
          </h1>
          <p className="text-slate-500 text-sm">
            邀請碼{' '}
            <span className="font-mono font-bold tracking-widest text-primary">
              {family?.inviteCode}
            </span>
          </p>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => setAwardOpen(true)}
          className="px-4 py-2 bg-accent text-white font-bold rounded-xl text-sm hover:bg-amber-500 transition"
        >
          ⭐ 發星星
        </button>
        {canDeduct && (
          <button
            type="button"
            onClick={() => { setDeductConfirmed(false); setDeductOpen(true); }}
            className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-700 transition hover:bg-red-50"
          >
            扣除星星
          </button>
        )}
        <Link
          to="/app/tasks"
          className="px-4 py-2 bg-primary text-white font-bold rounded-xl text-sm hover:bg-primary-600 transition"
        >
          + 任務
        </Link>
        <Link
          to="/app/rewards"
          className="px-4 py-2 bg-secondary text-white font-bold rounded-xl text-sm hover:bg-emerald-600 transition"
        >
          + 獎勵
        </Link>
      </div>

      {/* Kids cards */}
      <div>
        <h2 className="font-bold text-slate-700 mb-3">孩子們</h2>
        {kids.length === 0 ? (
          <p className="text-slate-400 text-sm">
            還沒有孩子加入，把邀請碼給孩子註冊吧！
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {kids.map(({ user: kid }) => (
              <div
                key={kid.id}
                className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex items-center gap-4"
              >
                <div className="w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center text-xl font-bold text-primary">
                  {kid.name[0]}
                </div>
                <div className="flex-1">
                  <div className="font-bold text-slate-800">{kid.name}</div>
                  <div className="text-accent font-extrabold">
                    ⭐ {kid.points}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending approvals */}
      {((pendingTasks?.completions?.length ?? 0) > 0 ||
        (pendingRedemptions?.redemptions?.length ?? 0) > 0 ||
        (pendingAllowance?.requests?.length ?? 0) > 0) && (
        <div>
          <h2 className="font-bold text-slate-700 mb-3">待審核</h2>
          <div className="space-y-2">
            {pendingTasks?.completions?.map((c) => (
              <div
                key={c.id}
                className="bg-white rounded-xl p-4 border border-slate-100 flex items-center justify-between gap-3"
              >
                <div>
                  <span className="font-semibold">{c.user.name}</span>
                  <span className="text-slate-500 text-sm">
                    {' '}
                    完成了「{c.titleSnapshot ?? c.task.title}」(+{c.pointsSnapshot ?? c.task.points}){c.localDate && ` · ${c.localDate}`}
                  </span>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={async () => {
                      await api.reviewTaskCompletion(c.id, 'APPROVED');
                      qc.invalidateQueries({ queryKey: ['pendingTasks'] });
                      qc.invalidateQueries({ queryKey: ['family'] });
                    }}
                    className="px-3 py-1 bg-secondary text-white text-sm font-bold rounded-lg"
                  >
                    通過
                  </button>
                  <button
                    onClick={async () => {
                      await api.reviewTaskCompletion(c.id, 'REJECTED');
                      qc.invalidateQueries({ queryKey: ['pendingTasks'] });
                    }}
                    className="px-3 py-1 bg-slate-200 text-slate-600 text-sm font-bold rounded-lg"
                  >
                    拒絕
                  </button>
                </div>
              </div>
            ))}
            {pendingRedemptions?.redemptions?.map((r) => (
              <div
                key={r.id}
                className="bg-white rounded-xl p-4 border border-slate-100 flex items-center justify-between gap-3"
              >
                <div>
                  <span className="font-semibold">{r.user.name}</span>
                  <span className="text-slate-500 text-sm">
                    {' '}
                    想兌換「{r.reward.title}」(-{r.costSnapshot ?? r.reservedPoints ?? r.reward.cost})
                  </span>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={async () => {
                      await api.reviewRedemption(r.id, 'APPROVED');
                      qc.invalidateQueries({
                        queryKey: ['pendingRedemptions'],
                      });
                      qc.invalidateQueries({ queryKey: ['family'] });
                    }}
                    className="px-3 py-1 bg-secondary text-white text-sm font-bold rounded-lg"
                  >
                    通過
                  </button>
                  <button
                    onClick={async () => {
                      await api.reviewRedemption(r.id, 'REJECTED');
                      qc.invalidateQueries({
                        queryKey: ['pendingRedemptions'],
                      });
                    }}
                    className="px-3 py-1 bg-slate-200 text-slate-600 text-sm font-bold rounded-lg"
                  >
                    拒絕
                  </button>
                </div>
              </div>
            ))}
            {pendingAllowance?.requests?.map((request) => (
              <div key={request.id} className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                <div><span className="font-semibold">{request.user?.name}</span><span className="text-sm text-slate-500"> 想兌換零用錢 NT${request.amountTwd}（保留 ⭐ {request.reservedPoints}）</span></div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={async () => { await api.reviewAllowance(request.id, 'APPROVED'); qc.invalidateQueries({ queryKey: ['pendingAllowance'] }); qc.invalidateQueries({ queryKey: ['family'] }); }} className="rounded-lg bg-secondary px-3 py-1 text-sm font-bold text-white">通過</button>
                  <button type="button" onClick={async () => { await api.reviewAllowance(request.id, 'REJECTED'); qc.invalidateQueries({ queryKey: ['pendingAllowance'] }); }} className="rounded-lg bg-slate-200 px-3 py-1 text-sm font-bold text-slate-700">拒絕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {deductOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
          <form onSubmit={handleDeduct} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6" role="dialog" aria-modal="true" aria-labelledby="deduct-title">
            <div><h3 id="deduct-title" className="text-lg font-extrabold text-slate-900">扣除星星</h3><p className="mt-1 text-sm text-slate-500">這項操作會永久記錄，請先確認以下內容。</p></div>
            <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><AlertTriangle className="mt-0.5 shrink-0" size={20} /><p><strong>請謹慎使用扣星。</strong><br />扣除星星可能讓孩子感到挫折。請確認這次扣除符合事前約定，並填寫孩子能理解的明確原因。扣星原因、時間與執行者都會永久保留，孩子也可以查看。</p></div>
            <label className="block text-sm font-bold text-slate-700">孩子<select required value={deductForm.userId} onChange={(event) => setDeductForm((form) => ({ ...form, userId: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal"><option value="">選擇孩子</option>{kids.map(({ user: kid }) => <option key={kid.id} value={kid.id}>{kid.name}（目前 ⭐ {kid.points}）</option>)}</select></label>
            <label className="block text-sm font-bold text-slate-700">扣除數量<input required type="number" min={1} max={kids.find(({ user: kid }) => kid.id === deductForm.userId)?.user.points} value={deductForm.amount} onChange={(event) => setDeductForm((form) => ({ ...form, amount: Number(event.target.value) }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal" /></label>
            {deductForm.userId && <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700"><span className="font-bold">餘額變化：</span>⭐ {kids.find(({ user: kid }) => kid.id === deductForm.userId)?.user.points ?? 0} → ⭐ {Math.max(0, (kids.find(({ user: kid }) => kid.id === deductForm.userId)?.user.points ?? 0) - deductForm.amount)}</div>}
            <label className="block text-sm font-bold text-slate-700">原因<input required value={deductForm.reason} onChange={(event) => setDeductForm((form) => ({ ...form, reason: event.target.value }))} placeholder="請使用孩子能理解的說法" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal" /></label>
            <label className="flex items-start gap-2 rounded-xl border border-red-200 p-3 text-sm text-slate-700"><input type="checkbox" checked={deductConfirmed} onChange={(event) => setDeductConfirmed(event.target.checked)} className="mt-0.5 h-5 w-5 accent-red-600" /><span>我已閱讀警語，並確認孩子、原因、數量與扣除後餘額皆正確。</span></label>
            <div className="flex gap-2"><button type="button" onClick={() => setDeductOpen(false)} className="flex-1 rounded-xl bg-slate-100 py-2 font-bold">取消</button><button type="submit" disabled={!deductConfirmed || deductLoading} className="flex-1 rounded-xl bg-red-600 py-2 font-bold text-white disabled:opacity-40">{deductLoading ? '處理中...' : '確認扣除'}</button></div>
          </form>
        </div>
      )}

      {/* Award modal */}
      {awardOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleAward}
            className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4"
          >
            <h3 className="font-extrabold text-lg">發放星星</h3>
            <div>
              <label className="text-sm font-semibold text-slate-600">
                給誰
              </label>
              <select
                value={awardForm.userId}
                onChange={(e) =>
                  setAwardForm((f) => ({ ...f, userId: e.target.value }))
                }
                required
                className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200"
              >
                <option value="">選擇孩子</option>
                {kids.map(({ user: k }) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-slate-600">
                數量
              </label>
              <input
                type="number"
                min={1}
                value={awardForm.amount}
                onChange={(e) =>
                  setAwardForm((f) => ({
                    ...f,
                    amount: Number(e.target.value),
                  }))
                }
                className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200"
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-slate-600">
                原因
              </label>
              <input
                value={awardForm.reason}
                onChange={(e) =>
                  setAwardForm((f) => ({ ...f, reason: e.target.value }))
                }
                required
                className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200"
                placeholder="例如：主動幫忙做家事"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAwardOpen(false)}
                className="flex-1 py-2 rounded-xl bg-slate-100 font-semibold"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={awardLoading}
                className="flex-1 py-2 rounded-xl bg-accent text-white font-bold disabled:opacity-60"
              >
                {awardLoading ? '發送中...' : '發放'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
