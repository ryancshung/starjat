interface Props {
  points: number;
  size?: 'sm' | 'md' | 'lg';
}

export default function StarJar({ points, size = 'lg' }: Props) {
  // 每 50 分一格循環填充
  const fill = (points % 50) / 50;
  const level = Math.floor(points / 50) + 1;
  const h = Math.max(8, fill * 130);

  const dims =
    size === 'lg'
      ? { w: 200, h: 240 }
      : size === 'md'
        ? { w: 140, h: 168 }
        : { w: 100, h: 120 };

  return (
    <div className="flex flex-col items-center">
      <svg
        width={dims.w}
        height={dims.h}
        viewBox="0 0 200 240"
        className="drop-shadow-md"
      >
        {/* Lid */}
        <rect x="55" y="20" width="90" height="18" rx="6" fill="#94A3B8" />
        <rect x="70" y="10" width="60" height="14" rx="5" fill="#64748B" />

        {/* Jar body */}
        <path
          d="M50 40 L50 200 Q50 220 100 220 Q150 220 150 200 L150 40 Z"
          fill="#E0F2FE"
          stroke="#3B82F6"
          strokeWidth="4"
        />

        {/* Fill */}
        {h >= 4 && (
          <rect
            x="54"
            y={72 + (130 - h)}
            width="92"
            height={h}
            rx="12"
            fill="#FDE68A"
          />
        )}

        {/* Stars decoration */}
        <text x="100" y="145" textAnchor="middle" fontSize="28" opacity="0.5">
          ⭐
        </text>
      </svg>

      <div className="mt-2 text-center">
        <div className="text-3xl font-extrabold text-accent">{points}</div>
        <div className="text-sm text-slate-500">星星 · 等級 {level}</div>
      </div>
    </div>
  );
}
