import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'PARENT' as 'PARENT' | 'CHILD',
    inviteCode: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register({
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
        inviteCode: form.role === 'CHILD' ? form.inviteCode : undefined,
      });
      if (form.role === 'PARENT') {
        navigate('/onboarding');
      } else {
        navigate('/app');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '註冊失敗');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-cream px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-lg p-8 border border-slate-100">
        <div className="text-center mb-6">
          <span className="text-4xl">⭐</span>
          <h1 className="text-2xl font-extrabold text-slate-800 mt-2">註冊 StarJar</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-2 rounded-xl">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            {(['PARENT', 'CHILD'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setForm((f) => ({ ...f, role: r }))}
                className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition ${
                  form.role === r
                    ? 'bg-primary text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {r === 'PARENT' ? '我是家長' : '我是孩子'}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-600 mb-1">
              暱稱
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="怎麼稱呼你？"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-600 mb-1">
              Email
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-600 mb-1">
              密碼
            </label>
            <input
              type="password"
              value={form.password}
              onChange={(e) =>
                setForm((f) => ({ ...f, password: e.target.value }))
              }
              required
              minLength={6}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="至少 6 個字元"
            />
          </div>

          {form.role === 'CHILD' && (
            <div>
              <label className="block text-sm font-semibold text-slate-600 mb-1">
                家庭邀請碼
              </label>
              <input
                value={form.inviteCode}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    inviteCode: e.target.value.toUpperCase(),
                  }))
                }
                required
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 tracking-widest font-mono text-center text-lg"
                placeholder="例如 ABC123"
              />
              <p className="text-xs text-slate-400 mt-1">
                請向家長索取 6 碼邀請碼
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-primary text-white font-bold rounded-xl hover:bg-primary-600 transition disabled:opacity-60"
          >
            {loading ? '註冊中...' : '建立帳號'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          已有帳號？{' '}
          <Link to="/login" className="text-primary font-semibold hover:underline">
            登入
          </Link>
        </p>
      </div>
    </div>
  );
}
