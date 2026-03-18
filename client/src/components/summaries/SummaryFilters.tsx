interface SummaryFiltersProps {
  riskLevel: string;
  tag: string;
  availableTags: string[];
  onRiskLevelChange: (value: string) => void;
  onTagChange: (value: string) => void;
}

const selectClass =
  'bg-[#21262d] border border-[#30363d] text-[#e6edf3] text-sm rounded px-3 py-1.5 min-h-[44px] focus:outline-none focus:border-[#58a6ff]';

export function SummaryFilters({
  riskLevel,
  tag,
  availableTags,
  onRiskLevelChange,
  onTagChange,
}: SummaryFiltersProps) {
  return (
    <div className="flex gap-3 flex-wrap">
      <select
        value={riskLevel}
        onChange={(e) => onRiskLevelChange(e.target.value)}
        className={selectClass}
        aria-label="Filter by risk level"
      >
        <option value="">All risk levels</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>

      <select
        value={tag}
        onChange={(e) => onTagChange(e.target.value)}
        className={selectClass}
        aria-label="Filter by tag"
      >
        <option value="">All tags</option>
        {availableTags.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}
