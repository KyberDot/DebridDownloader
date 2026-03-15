interface TableToolbarProps {
  title: string;
  subtitle?: string;
  filterPlaceholder?: string;
  filterValue: string;
  onFilterChange: (value: string) => void;
  actions?: React.ReactNode;
}

export default function TableToolbar({
  title,
  subtitle,
  filterPlaceholder = "Filter...",
  filterValue,
  onFilterChange,
  actions,
}: TableToolbarProps) {
  return (
    <div className="flex justify-between items-center px-7 py-5 shrink-0">
      <div className="min-w-0">
        <h2 className="text-[22px] font-bold text-[#f1f5f9] tracking-[-0.3px] m-0">
          {title}
        </h2>
        {subtitle && (
          <p className="text-[13px] text-[#475569] mt-1">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="relative">
          <input
            type="text"
            value={filterValue}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder={filterPlaceholder}
            style={{ paddingLeft: "36px" }}
            className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] rounded-lg py-2.5 pr-4 text-[14px] text-[#f1f5f9] w-[220px] outline-none placeholder:text-[#374151] focus:border-[rgba(16,185,129,0.3)] transition-colors"
          />
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#374151"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute left-[12px] top-1/2 -translate-y-1/2 pointer-events-none"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        {actions}
      </div>
    </div>
  );
}
