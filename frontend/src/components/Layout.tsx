import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import {
  Home,
  ListTodo,
  Gift,
  Users,
  History,
  Shield,
  CalendarClock,
  Trophy,
  ChartNoAxesColumnIncreasing,
  CircleHelp,
  LogOut,
} from 'lucide-react';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isParent = user?.role === 'PARENT' || user?.role === 'ADMIN';
  const isAdmin = user?.role === 'ADMIN';

  const nav = [
    { to: '/app', icon: Home, label: '首頁', end: true },
    { to: '/app/tasks', icon: ListTodo, label: '任務' },
    { to: '/app/rewards', icon: Gift, label: '獎勵' },
    { to: '/app/trophies', icon: Trophy, label: '獎盃' },
    { to: '/app/scheduled-awards', icon: CalendarClock, label: '零用錢' },
    { to: '/app/family', icon: Users, label: '家庭' },
    { to: '/app/history', icon: History, label: '紀錄' },
    { to: '/app/reports', icon: ChartNoAxesColumnIncreasing, label: '月報' },
    { to: '/app/guide', icon: CircleHelp, label: '說明' },
  ];
  if (isAdmin) {
    nav.push({ to: '/app/admin', icon: Shield, label: '管理' });
  }

  return (
    <div className="min-h-screen flex flex-col bg-cream">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⭐</span>
            <span className="font-extrabold text-primary text-lg">StarJar</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600 hidden sm:inline">
              {user?.name}
              {isParent && (
                <span className="ml-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  {user?.role === 'ADMIN' ? 'Admin' : '家長'}
                </span>
              )}
              {!isParent && (
                <span className="ml-2 text-accent font-bold">
                  ⭐ {user?.points ?? 0}
                </span>
              )}
            </span>
            <button
              onClick={() => {
                logout();
                navigate('/');
              }}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
              title="登出"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>

        {/* Desktop nav - 放在 header 內，跟著文件流，不會蓋住內容 */}
        <nav className="hidden md:block border-t border-slate-100">
          <div className="max-w-5xl mx-auto px-4 flex gap-1">
            {nav.map(({ to, icon: Icon, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
                    isActive
                      ? 'border-primary text-primary'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`
                }
              >
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 pb-24 md:pb-8">
        <Outlet />
      </main>

      {/* Bottom nav (mobile only) */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 md:hidden z-20 safe-area-pb">
        <div className="flex justify-start overflow-x-auto py-2">
          {nav.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex min-w-[4.5rem] flex-col items-center gap-0.5 px-2 py-1 text-xs ${
                  isActive ? 'text-primary font-bold' : 'text-slate-500'
                }`
              }
            >
              <Icon size={20} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
