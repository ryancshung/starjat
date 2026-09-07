import { Link } from 'react-router-dom';
import { Trophy, CalendarClock, Users, History, ChartNoAxesColumnIncreasing, CircleHelp, Shield, ChevronRight } from 'lucide-react';
import { useAuth } from '../lib/auth';

export default function More() {
  const {user}=useAuth();
  const links=[
    {to:'reports',label:'月報',icon:ChartNoAxesColumnIncreasing},
    {to:'family',label:'家庭',icon:Users},
    {to:'history',label:'紀錄',icon:History},
    {to:'trophies',label:'獎盃',icon:Trophy},
    {to:'scheduled-awards',label:'零用錢',icon:CalendarClock},
    {to:'guide',label:'說明',icon:CircleHelp},
    ...(user?.role==='ADMIN'?[{to:'admin',label:'管理',icon:Shield}]:[]),
  ];
  return <section className="space-y-4"><h1 className="text-2xl font-extrabold">更多</h1><nav aria-label="更多功能" className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">{links.map(({to,label,icon:Icon})=><Link key={to} to={`/app/${to}`} className="flex min-h-14 items-center gap-3 px-4 py-3 font-bold text-slate-700 hover:bg-slate-50"><Icon aria-hidden="true" size={20}/><span className="flex-1">{label}</span><ChevronRight aria-hidden="true" size={18}/></Link>)}</nav></section>;
}
