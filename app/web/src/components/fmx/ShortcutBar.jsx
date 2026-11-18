const SHORTCUTS = [
  { key: "a", label: "Add Node", action: "add-node" },
  { key: "w", label: "What-If", action: "what-if" },
  { key: "m", label: "Run Migration", action: "migrate" },
  { key: "s", label: "Scale", action: "what-if" },
  { key: "↑↓", label: "Navegar" },
  { key: "1-4", label: "Abas" },
  { key: "b", label: "Blueprint" },
  { key: "q", label: "Quit", action: "quit" },
];

export function ShortcutBar({ tab, onAction }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-surface0/70 bg-mantle/60 px-4 py-2 text-[10px]">
      <span className="uppercase tracking-[0.18em] text-overlay0">
        ‹{tab}›
      </span>
      {SHORTCUTS.map((item) =>
        item.action ? (
          <button
            key={`${item.key}-${item.label}`}
            type="button"
            onClick={() => onAction(item.action)}
            className="group flex items-center gap-1.5 text-sub0 transition-colors hover:text-mauve"
          >
            <span className="text-mauve group-hover:text-lavender">[{item.key}]</span>
            <span>{item.label}</span>
          </button>
        ) : (
          <span key={`${item.key}-${item.label}`} className="flex items-center gap-1.5 text-overlay1">
            <span className="text-mauve/70">[{item.key}]</span>
            <span>{item.label}</span>
          </span>
        ),
      )}
      <span className="ml-auto hidden items-center gap-1.5 text-overlay0 sm:flex">
        <span className="h-1.5 w-1.5 rounded-full bg-green tui-live" />
        streaming
      </span>
    </div>
  );
}