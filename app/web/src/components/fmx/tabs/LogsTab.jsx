import { useEffect, useRef } from "react";

const LEVEL_TONE = {
  INFO: "text-blue",
  WARN: "text-peach",
  ERROR: "text-red",
  OK: "text-green",
  CMD: "text-mauve",
};

const STATUS_TONE = {
  success: "text-green",
  failed: "text-red",
  running: "text-yellow",
};

export function LogsTab({ lines = [], running, deployments = [] }) {
  const box = useRef(null);

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines.length, running]);

  return (
    <div>
      <div
        ref={box}
        className="max-h-[220px] min-h-[170px] overflow-y-auto px-4 py-3 text-[10.5px] leading-[1.7] sm:max-h-[260px]"
      >
        {lines.map((line, index) => (
          <div key={`${line.t}-${index}`} className="flex gap-2 sm:gap-3">
            <span className="shrink-0 tabular-nums text-overlay0">{line.t}</span>
            <span className={`w-10 shrink-0 text-[9px] ${LEVEL_TONE[line.level] || "text-sub0"}`}>
              {line.level}
            </span>
            <span className="min-w-0 whitespace-pre-wrap break-words text-sub1">{line.msg}</span>
          </div>
        ))}
        <div className={`mt-1 flex gap-2 ${running ? "text-mauve" : "text-overlay0"}`}>
          <span>{running ? "▌" : "$"}</span>
          <span className="tui-caret" />
        </div>
      </div>

      {deployments.length > 0 && (
        <div className="border-t border-surface0/50 px-4 py-2">
          <div className="mb-1 text-[9px] uppercase tracking-[0.2em] text-overlay0">
            últimos deploys
          </div>
          {deployments.slice(0, 3).map((item) => (
            <div key={item.id} className="flex items-center gap-2 py-0.5 text-[10px]">
              <span className={STATUS_TONE[item.status] || "text-overlay1"}>●</span>
              <span className="shrink-0 text-sub0">{item.kind}</span>
              <span className="min-w-0 truncate text-overlay1">{item.summary}</span>
              <span className="ml-auto shrink-0 tabular-nums text-overlay0">
                {Number(item.duration_s || 0).toFixed(1)}s
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}