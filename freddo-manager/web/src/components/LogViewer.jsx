import { useEffect, useRef, useState } from "react";
import { stream } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function LogViewer({ path, maxLines = 500, height = "h-72" }) {
  const [lines, setLines] = useState([]);
  const [connected, setConnected] = useState(false);
  const container = useRef(null);

  useEffect(() => {
    setLines([]);
    let lastSeq = 0;
    const close = stream(path, {
      onEvent: (event) => {
        if (event.type === "line" && typeof event.line === "string") {
          if (event.seq) lastSeq = Math.max(lastSeq, event.seq);
          setLines((current) => [...current.slice(-maxLines), { ...event }]);
        }
        if (event.type === "error" || event.type === "done" || event.type === "job_done") setConnected(false);
      },
      onError: () => setConnected(false),
      lastEventId: undefined,
    });
    setConnected(true);
    return close;
  }, [path, maxLines]);

  useEffect(() => {
    if (container.current) container.current.scrollTop = container.current.scrollHeight;
  }, [lines]);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-crust">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <span>stream · {path}</span>
        <span className={connected ? "text-green" : "text-peach"}>{connected ? "ao vivo" : "conectando..."}</span>
      </div>
      <div ref={container} className={`${height} overflow-auto p-3 font-mono text-[11px] leading-relaxed`}>
        {lines.length === 0 ? (
          <span className="text-muted-foreground">Aguardando eventos…</span>
        ) : (
          lines.map((line, index) => (
            <div key={`${line.seq || index}-${index}`} className="flex gap-3">
              <span className="select-none text-overlay0">{line.seq ? String(line.seq).padStart(4, "0") : "·"}</span>
              <span className={line.stream === "stderr" ? "text-red" : "text-sub1"}>{line.line}</span>
            </div>
          ))
        )}
      </div>
      <div className="flex justify-end border-t border-border px-3 py-1.5">
        <Button variant="ghost" size="sm" onClick={() => setLines([])}>Limpar</Button>
      </div>
    </div>
  );
}
