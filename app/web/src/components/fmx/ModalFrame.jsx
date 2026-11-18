export function ModalFrame({ title, hint, onClose, children, footer, width = "max-w-lg" }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-crust/85 p-4 py-10 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className={`w-full ${width} border border-mauve/40 bg-base shadow-[0_0_70px_-12px_rgba(203,166,247,0.5)]`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-surface0 bg-mantle px-4 py-2">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] uppercase tracking-[0.22em] text-mauve">{title}</span>
            {hint && <span className="text-[9px] text-overlay0">{hint}</span>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[10px] uppercase tracking-[0.16em] text-overlay1 transition-colors hover:text-red"
          >
            esc ✕
          </button>
        </div>
        <div className="max-h-[68vh] overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-between gap-3 border-t border-surface0 bg-mantle px-4 py-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export const inputClass =
  "w-full border border-surface1 bg-crust px-2 py-1.5 text-[11.5px] text-ink placeholder:text-overlay0 focus:border-mauve focus:outline-none";

export const labelClass =
  "mb-1 block text-[9px] uppercase tracking-[0.18em] text-overlay0";

export const primaryButton =
  "border border-mauve/70 bg-mauve/15 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-mauve transition-colors hover:bg-mauve/25 disabled:cursor-not-allowed disabled:border-surface1 disabled:bg-transparent disabled:text-overlay0";

export const ghostButton =
  "border border-surface1 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-sub0 transition-colors hover:border-overlay1 hover:text-ink";