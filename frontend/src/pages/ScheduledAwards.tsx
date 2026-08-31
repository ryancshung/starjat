import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CalendarClock, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const statusLabels = { PENDING: '等待家長核准', APPROVED: '已核准', REJECTED: '未核准', CANCELLED: '已撤回' };
const frequencyLabels = { daily: '每天', weekly: '每週', monthly: '每月' };
const weekdayLabels = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

export default function ScheduledAwards() {
  const { user } = useAuth();
  const isParent = user?.role === 'PARENT' || user?.role === 'ADMIN';
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amountTwd, setAmountTwd] = useState(1);
  const [form, setForm] = useState({ userId: '', name: '', amount: 5, frequency: 'weekly' as 'daily' | 'weekly' | 'monthly', localTime: '09:00', weekday: 6, dayOfMonth: 1, startAt: '' });
  const { data: familyData } = useQuery({ queryKey: ['family'], queryFn: api.getMyFamily });
  const { data: allowanceData, isLoading: allowanceLoading } = useQuery({ queryKey: ['allowance'], queryFn: api.getAllowance });
  const { data: balance } = useQuery({ queryKey: ['balance'], queryFn: api.getBalance, enabled: !isParent });
  const { data: schedules, isLoading } = useQuery({ queryKey: ['scheduledAwards'], queryFn: api.getScheduledAwards, enabled: isParent });
  const family = familyData?.family;
  const children = family?.members.filter((member) => member.user.role === 'CHILD') ?? [];
  const ratio = allowanceData?.settings?.pointsPerTwd;
  const requiredPoints = amountTwd * (ratio ?? 0);

  const createSchedule = async (event: React.FormEvent) => {
    event.preventDefault();
    await api.createScheduledAward({ ...form, weekday: form.frequency === 'weekly' ? form.weekday : null, dayOfMonth: form.frequency === 'monthly' ? form.dayOfMonth : null, startAt: form.startAt ? new Date(form.startAt).toISOString() : new Date().toISOString() });
    setOpen(false);
    setForm({ userId: '', name: '', amount: 5, frequency: 'weekly', localTime: '09:00', weekday: 6, dayOfMonth: 1, startAt: '' });
    qc.invalidateQueries({ queryKey: ['scheduledAwards'] });
  };

  return (
    <div className="space-y-8">
      <header><h1 className="text-2xl font-extrabold text-slate-800">零用錢與定期派發</h1><p className="mt-1 text-sm text-slate-500">兌換零用錢，或按家庭時區安排固定星星。</p></header>

      <section className="rounded-2xl border border-emerald-100 bg-white p-5" aria-labelledby="allowance-title">
        <div className="flex items-start justify-between gap-4"><div className="flex gap-3"><div className="rounded-xl bg-emerald-50 p-2 text-emerald-700"><Banknote size={22} /></div><div><h2 id="allowance-title" className="font-extrabold text-slate-800">零用錢兌換</h2><p className="text-sm text-slate-500">{ratio ? `目前比例：⭐ ${ratio} = NT$1` : '家庭管理者尚未設定兌換比例'}</p></div></div>{isParent && <a href="/app/family" className="text-sm font-bold text-primary">管理比例</a>}</div>

        {!isParent && ratio && (
          <form onSubmit={async (event) => { event.preventDefault(); await api.requestAllowance(amountTwd); setAmountTwd(1); qc.invalidateQueries({ queryKey: ['allowance'] }); qc.invalidateQueries({ queryKey: ['balance'] }); }} className="mt-5 grid gap-3 rounded-xl bg-emerald-50 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="text-sm font-bold text-emerald-950">想兌換的金額（整數新台幣）<input type="number" min={1} value={amountTwd} onChange={(event) => setAmountTwd(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 font-normal" /><span className="mt-1 block text-xs font-normal">需要 ⭐ {requiredPoints}；可用 ⭐ {balance?.availablePoints ?? 0}{allowanceData.settings?.monthlyAllowanceLimitTwd ? `；每月上限 NT$${allowanceData.settings.monthlyAllowanceLimitTwd}` : ''}</span></label>
            <button type="submit" disabled={requiredPoints <= 0 || requiredPoints > (balance?.availablePoints ?? 0)} className="rounded-xl bg-emerald-600 px-5 py-2 font-bold text-white disabled:opacity-40">申請兌換</button>
          </form>
        )}

        <div className="mt-5 space-y-2">
          {allowanceLoading ? <p role="status" className="text-sm text-slate-500">載入中...</p> : !allowanceData?.requests.length ? <p className="text-sm text-slate-500">目前沒有零用錢兌換紀錄。</p> : allowanceData.requests.map((request) => (
            <div key={request.id} className="flex flex-col gap-2 border-t border-slate-100 py-3 sm:flex-row sm:items-center sm:justify-between"><div><span className="font-bold">{isParent ? `${request.user?.name} · ` : ''}NT${request.amountTwd}</span><span className="ml-2 text-sm text-slate-500">⭐ {request.reservedPoints} · {statusLabels[request.status]}</span><div className="text-xs text-slate-400">{new Date(request.createdAt).toLocaleString('zh-TW')}</div></div>{!isParent && request.status === 'PENDING' && <button type="button" onClick={async () => { await api.cancelAllowance(request.id); qc.invalidateQueries({ queryKey: ['allowance'] }); qc.invalidateQueries({ queryKey: ['balance'] }); }} className="inline-flex items-center gap-1 self-start text-sm font-bold text-red-600"><RotateCcw size={14} />撤回申請</button>}</div>
          ))}
        </div>
      </section>

      {isParent && (
        <section aria-labelledby="schedule-title">
          <div className="mb-3 flex items-center justify-between gap-4"><div><h2 id="schedule-title" className="flex items-center gap-2 font-extrabold text-slate-800"><CalendarClock size={20} className="text-primary" />定期發星星</h2><p className="text-sm text-slate-500">以 {family?.timezone ?? 'Asia/Taipei'} 執行；錯過多期只補最近一期。</p></div><button type="button" onClick={() => setOpen(true)} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white">新增設定</button></div>
          {isLoading ? <p role="status" className="text-slate-500">載入中...</p> : !schedules?.schedules.length ? <p className="text-sm text-slate-500">尚未建立定期派發設定。</p> : <div className="space-y-3">{schedules.schedules.map((schedule) => <article key={schedule.id} className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-5 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-bold">{schedule.name} <span className="font-normal text-slate-400">→ {schedule.user?.name}</span></div><div className="mt-1 text-sm text-slate-600">{frequencyLabels[schedule.frequency]}{schedule.frequency === 'weekly' ? ` ${weekdayLabels[schedule.weekday ?? 0]}` : schedule.frequency === 'monthly' ? ` ${schedule.dayOfMonth} 日` : ''} {schedule.localTime} 派發 <strong className="text-amber-600">⭐ {schedule.amount}</strong></div><div className="text-xs text-slate-400">{schedule.nextRunAt ? `下次：${new Date(schedule.nextRunAt).toLocaleString('zh-TW')}` : '等待計算下次時間'}</div></div><div className="flex gap-3 text-sm font-bold"><button type="button" onClick={async () => { await api.updateScheduledAward(schedule.id, { isActive: !schedule.isActive }); qc.invalidateQueries({ queryKey: ['scheduledAwards'] }); }} className="text-primary">{schedule.isActive ? '暫停' : '啟用'}</button><button type="button" onClick={async () => { if (!window.confirm('確定刪除這個定期派發嗎？')) return; await api.deleteScheduledAward(schedule.id); qc.invalidateQueries({ queryKey: ['scheduledAwards'] }); }} className="text-red-600">刪除</button></div></article>)}</div>}
        </section>
      )}

      {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={createSchedule} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6" role="dialog" aria-modal="true" aria-labelledby="schedule-form-title"><h2 id="schedule-form-title" className="text-lg font-extrabold">新增定期派發</h2><label className="block text-sm font-bold">孩子<select required value={form.userId} onChange={(event) => setForm((value) => ({ ...value, userId: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal"><option value="">選擇孩子</option>{children.map((member) => <option key={member.user.id} value={member.user.id}>{member.user.name}</option>)}</select></label><label className="block text-sm font-bold">名稱<input required value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} placeholder="例如：每週固定星星" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal" /></label><div className="grid grid-cols-2 gap-3"><label className="text-sm font-bold">星星數<input required type="number" min={1} value={form.amount} onChange={(event) => setForm((value) => ({ ...value, amount: Number(event.target.value) }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal" /></label><label className="text-sm font-bold">頻率<select value={form.frequency} onChange={(event) => setForm((value) => ({ ...value, frequency: event.target.value as typeof value.frequency }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal"><option value="daily">每天</option><option value="weekly">每週</option><option value="monthly">每月</option></select></label></div>{form.frequency === 'weekly' && <label className="block text-sm font-bold">星期<select value={form.weekday} onChange={(event) => setForm((value) => ({ ...value, weekday: Number(event.target.value) }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal">{weekdayLabels.map((label, index) => <option key={label} value={index}>{label}</option>)}</select></label>}{form.frequency === 'monthly' && <label className="block text-sm font-bold">每月日期<input type="number" min={1} max={31} value={form.dayOfMonth} onChange={(event) => setForm((value) => ({ ...value, dayOfMonth: Number(event.target.value) }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal" /></label>}<label className="block text-sm font-bold">執行時間<input type="time" step={900} required value={form.localTime} onChange={(event) => setForm((value) => ({ ...value, localTime: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal" /></label><label className="block text-sm font-bold">開始日期（選填）<input type="datetime-local" value={form.startAt} onChange={(event) => setForm((value) => ({ ...value, startAt: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal" /></label><div className="flex gap-2"><button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-xl bg-slate-100 py-2 font-bold">取消</button><button className="flex-1 rounded-xl bg-primary py-2 font-bold text-white">建立</button></div></form></div>}
    </div>
  );
}
