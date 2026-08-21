import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import StarJar from '../components/StarJar';
import { Link } from 'react-router-dom';

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

  const family = familyData?.family;
  const kids =
    family?.members.filter((m) => m.user.role === 'CHILD') ?? [];

  const childPoints = balanceData?.points ?? user?.points ?? 0;

  // Award dialog
  const [awardOpen, setAwardOpen] = useState(false);
  const [awardForm, setAwardForm] = useState({
    userId: '',
    amount: 5,
    reason: '',
  });
  const [awardLoading, setAwardLoading] = useState(false);

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
        (pendingRedemptions?.redemptions?.length ?? 0) > 0) && (
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
                    完成了「{c.task.title}」(+{c.task.points})
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
                    想兌換「{r.reward.title}」(-{r.reward.cost})
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
          </div>
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
