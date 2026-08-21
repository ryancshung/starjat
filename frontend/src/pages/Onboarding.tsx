import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Onboarding() {
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.createFamily(name);
      await refreshUser();
      navigate('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立失敗');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-cream px-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-lg p-8 border border-slate-100">
        <div className="text-center mb-6">
          <span className="text-4xl">🏠</span>
          <h1 className="text-2xl font-extrabold text-slate-800 mt-2">
            建立你的家庭
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            建立後會產生邀請碼，孩子可用邀請碼加入
          </p>
        </div>

        <form onSubmit={handleCreate} className="space-y-4">
          {error && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-2 rounded-xl">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-semibold text-slate-600 mb-1">
              家庭名稱
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="例如：幸福小家"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-primary text-white font-bold rounded-xl hover:bg-primary-600 transition disabled:opacity-60"
          >
            {loading ? '建立中...' : '建立家庭'}
          </button>
        </form>
      </div>
    </div>
  );
}
