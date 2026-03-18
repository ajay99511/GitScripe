interface StatusBadgeProps {
  status: 'idle' | 'syncing' | 'error';
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const styles = {
    idle: 'bg-[#30363d] text-[#8b949e]',
    syncing: 'bg-[#1f3a5f] text-[#58a6ff] animate-pulse',
    error: 'bg-[#3d1f1f] text-[#f85149]',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}
