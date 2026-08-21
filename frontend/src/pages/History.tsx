import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export default function History() {
  const { data, isLoading } = useQuery({
    queryKey: ['pointHistory'],
    queryFn: () => api.getPointHistory(),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-slate-800">星星紀錄</h1>

      {isLoading ? (
        <p className="text-slate-400">載入中...</p>
      ) : !data?.transactions?.length ? (
        <p className="text-slate-400">目前沒有紀錄</p>
      ) : (
        <div className="space-y-2">
          {data.transactions.map((tx) => (
            <div
              key={tx.id}
              className="bg-white rounded-xl p-4 border border-slate-100 flex items-center justify-between"
            >
              <div>
                <div className="font-semibold text-slate-800">{tx.reason}</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {new Date(tx.createdAt).toLocaleString('zh-TW')}
                </div>
              </div>
              <div
                className={`font-extrabold text-lg ${
                  tx.amount > 0 ? 'text-secondary' : 'text-red-500'
                }`}
              >
                {tx.amount > 0 ? '+' : ''}
                {tx.amount}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
