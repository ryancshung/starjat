import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
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
  const [form, setForm] = useState({ title: '', description: '', cost: 10 });
  const [loading, setLoading] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.createReward({
        title: form.title,
        description: form.description || undefined,
        cost: form.cost,
      });
      setOpen(false);
      setForm({ title: '', description: '', cost: 10 });
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
          <button
            onClick={() => setOpen(true)}
            className="px-4 py-2 bg-secondary text-white font-bold rounded-xl text-sm"
          >
            + 新增獎勵
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-slate-400">載入中...</p>
      ) : !data?.rewards?.length ? (
        <p className="text-slate-400">目前沒有獎勵</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {data.rewards.map((reward) => (
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
              <div className="mt-3 flex items-center justify-between">
                <span className="text-accent font-extrabold">
                  ⭐ {reward.cost}
                </span>
                {!isParent && (
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

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreate}
            className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4"
          >
            <h3 className="font-extrabold text-lg">新增獎勵</h3>
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
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 py-2 rounded-xl bg-slate-100 font-semibold"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2 rounded-xl bg-secondary text-white font-bold disabled:opacity-60"
              >
                {loading ? '建立中...' : '建立'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
