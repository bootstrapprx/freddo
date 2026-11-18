// Braille rasterisation: one character cell = 2 x 4 dots.
// Produces a filled area chart made of U+2800 block-dot glyphs.

const DOTS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

function resample(values, count) {
  if (!values || values.length === 0) return new Array(count).fill(0);
  if (values.length === 1) return new Array(count).fill(values[0]);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const t = (i / (count - 1)) * (values.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(values.length - 1, lo + 1);
    out.push(values[lo] + (values[hi] - values[lo]) * (t - lo));
  }
  return out;
}

export function brailleBlock(values, width = 40, height = 4) {
  const cols = Math.max(1, width);
  const series = resample(
    (values || []).map((v) => Math.min(1, Math.max(0, Number(v) || 0))),
    cols * 2,
  );
  const rows = [];
  for (let r = 0; r < height; r += 1) {
    let line = "";
    for (let c = 0; c < cols; c += 1) {
      let bits = 0;
      for (let sx = 0; sx < 2; sx += 1) {
        const fill = Math.round(series[c * 2 + sx] * height * 4);
        for (let sy = 0; sy < 4; sy += 1) {
          const fromBottom = (height - 1 - r) * 4 + (3 - sy);
          if (fromBottom < fill) bits |= DOTS[sy][sx];
        }
      }
      line += bits ? String.fromCharCode(0x2800 + bits) : " ";
    }
    rows.push(line);
  }
  return rows;
}

export function sparkline(values) {
  const glyphs = "▁▂▃▄▅▆▇█";
  const list = (values || []).slice(-24);
  if (!list.length) return "";
  const max = Math.max(...list, 0.0001);
  return list
    .map((v) => glyphs[Math.min(glyphs.length - 1, Math.round((v / max) * (glyphs.length - 1)))])
    .join("");
}