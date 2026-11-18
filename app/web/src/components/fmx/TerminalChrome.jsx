export function TerminalChrome({ title, children }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-surface0/80 bg-base shadow-[0_40px_140px_-50px_rgba(203,166,247,0.55)]">
      <div className="flex items-center gap-3 border-b border-surface0/70 bg-mantle px-4 py-2">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-yellow/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-green/80" />
        </div>
        <span className="mx-auto truncate text-[10px] uppercase tracking-[0.26em] text-overlay0">
          {title}
        </span>
        <span className="hidden text-[10px] text-overlay0 sm:block">tty1</span>
      </div>
      {children}
    </div>
  );
}