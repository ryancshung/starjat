import { useEffect, useState } from 'react';

export default function PasswordResetDialog({ targetName, onClose, onSubmit }: { targetName: string; onClose: () => void; onSubmit: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPassword(''); setConfirmation(''); setMessage(''); setBusy(false); }, [targetName]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 6 || password.length > 128) { setMessage('新密碼必須為 6–128 個字元。'); return; }
    if (password !== confirmation) { setMessage('兩次輸入的密碼不一致。'); return; }
    setBusy(true); setMessage('');
    try { await onSubmit(password); onClose(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '密碼重設失敗'); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
    <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6" role="dialog" aria-modal="true" aria-labelledby="password-reset-title" aria-describedby="password-reset-help">
      <div><h2 id="password-reset-title" className="text-lg font-extrabold text-slate-900">重設 {targetName} 的密碼</h2><p id="password-reset-help" className="mt-1 text-sm text-slate-500">設定後請將新密碼告訴本人；已登入的裝置不會被登出。</p></div>
      {message&&<p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}
      <label className="block text-sm font-bold text-slate-700">新密碼<input autoFocus autoComplete="new-password" type="password" minLength={6} maxLength={128} required value={password} onChange={event=>setPassword(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal focus:outline-none focus:ring-2 focus:ring-primary/40" /></label>
      <label className="block text-sm font-bold text-slate-700">再次輸入新密碼<input autoComplete="new-password" type="password" minLength={6} maxLength={128} required value={confirmation} onChange={event=>setConfirmation(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal focus:outline-none focus:ring-2 focus:ring-primary/40" /></label>
      <div className="flex gap-2"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 flex-1 rounded-xl bg-slate-100 px-4 py-2 font-bold text-slate-700 disabled:opacity-50">取消</button><button type="submit" disabled={busy} className="min-h-11 flex-1 rounded-xl bg-primary px-4 py-2 font-bold text-white disabled:opacity-50">{busy?'重設中…':'確認重設'}</button></div>
    </form>
  </div>;
}
