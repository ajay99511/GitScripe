interface RiskBadgeProps {
  level: 'low' | 'medium' | 'high';
}

export function RiskBadge({ level }: RiskBadgeProps) {
  const styles = {
    low: 'bg-[#1f3a2a] text-[#3fb950]',
    medium: 'bg-[#3a2e1f] text-[#d29922]',
    high: 'bg-[#3d1f1f] text-[#f85149]',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[level]}`}>
      {level}
    </span>
  );
}
