import { useMemo } from "react";
import { brailleBlock } from "@/lib/braille";

export function BrailleChart({
  values = [],
  width = 46,
  height = 4,
  tone = "text-mauve",
  className = "",
}) {
  const rows = useMemo(
    () => brailleBlock(values, width, height),
    [values, width, height],
  );
  return (
    <pre
      aria-hidden="true"
      className={`select-none overflow-hidden text-[10px] leading-[11px] ${tone} ${className}`}
    >
      {rows.join("\n")}
    </pre>
  );
}