import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Navigate } from 'react-router-dom';

export default function Landing() {
  const { user, loading } = useAuth();
  if (!loading && user) return <Navigate to="/app" replace />;

  return (
    <div className="min-h-screen bg-cream">
      <header className="max-w-5xl mx-auto px-4 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-3xl">⭐</span>
          <span className="font-extrabold text-primary text-2xl">StarJar</span>
        </div>
        <div className="flex gap-3">
          <Link
            to="/login"
            className="px-4 py-2 text-primary font-semibold hover:bg-primary/10 rounded-xl transition"
          >
            登入
          </Link>
          <Link
            to="/register"
            className="px-4 py-2 bg-primary text-white font-semibold rounded-xl hover:bg-primary-600 transition"
          >
            開始使用
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-16 text-center">
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-800 leading-tight">
          把好行為變成
          <span className="text-primary"> 閃亮星星</span>
        </h1>
        <p className="mt-4 text-lg text-slate-600 max-w-xl mx-auto">
          家長設定任務與獎勵，孩子完成任務賺取星星，一起打造溫暖的家庭獎勵系統。
        </p>

        <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            to="/register"
            className="px-8 py-3.5 bg-primary text-white font-bold text-lg rounded-2xl shadow-lg shadow-primary/30 hover:bg-primary-600 transition"
          >
            免費開始
          </Link>
          <Link
            to="/login"
            className="px-8 py-3.5 bg-white text-primary font-bold text-lg rounded-2xl border-2 border-primary/20 hover:border-primary/40 transition"
          >
            已有帳號
          </Link>
        </div>

        <div className="mt-20 grid md:grid-cols-3 gap-6 text-left">
          {[
            {
              title: '任務與審核',
              desc: '家長建立任務，孩子完成後由家長審核發放星星。',
              icon: '✅',
            },
            {
              title: '獎勵兌換',
              desc: '用星星兌換家庭獎勵，讓努力看得見。',
              icon: '🎁',
            },
            {
              title: '家庭一起玩',
              desc: '邀請碼輕鬆加入，家長與孩子各自儀表板。',
              icon: '👨‍👩‍👧‍👦',
            },
          ].map((f) => (
            <div
              key={f.title}
              className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100"
            >
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="font-bold text-lg text-slate-800">{f.title}</h3>
              <p className="mt-1 text-slate-500 text-sm">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
