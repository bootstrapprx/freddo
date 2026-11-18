export function ConfigTab({ rows = [] }) {
  return (
    <div className="px-4 py-3">
      <div className="border border-surface0/60 bg-mantle/30">
        {rows.map(([key, value], index) => (
          <div
            key={key}
            className={`grid grid-cols-[minmax(108px,150px)_1fr] gap-3 px-3 py-1.5 text-[10.5px] ${
              index > 0 ? "border-t border-surface0/30" : ""
            }`}
          >
            <span className="truncate text-overlay0">{key}</span>
            <span className="truncate text-sub1">{value}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[9px] uppercase tracking-[0.16em] text-overlay0">
        <span>[m] run migration</span>
        <span>[s] scale bench</span>
        <span>arquivo: ~/frappe-bench/sites/common_site_config.json</span>
      </div>
    </div>
  );
}