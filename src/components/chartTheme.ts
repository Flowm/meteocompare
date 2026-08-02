// Single source for the ECharts chart palette + font.
//
// ECharts can't read CSS custom properties (it renders to a canvas, off the
// DOM), so the theme tokens defined in style.css `@theme` have to be restated
// here as literals. The named constants below MIRROR those tokens — keep the
// two in sync by hand; the comment on each names the token it tracks. This is
// the ONE place the raw hexes live, so chartOption / chartTooltip reference
// meaning rather than magic numbers.

// Surface + type tokens (mirror style.css @theme)
export const INK_950 = "#050810"; // --color-ink-950 (page floor)
export const INK_800 = "#131d2d"; // --color-ink-800 (grid split-lines)
export const INK_700 = "#1a2638"; // --color-ink-700 (hairline / tooltip border)
export const INK_600 = "#243349"; // --color-ink-600 (x-axis line)
export const PAPER_50 = "#f4ecd8"; // --color-paper-50 (primary text)
export const PAPER_200 = "#c9bea4"; // --color-paper-200 (chart base text)
export const PAPER_300 = "#93896f"; // --color-paper-300 (axis labels / names)
export const SODIUM_300 = "#f5b942"; // --color-sodium-300 (hero accent)
export const RAIN_300 = "#7fb8e0"; // --color-rain-300 (precipitation accent)

// Chart series colours
// "Observatory" palette: coral = aggregate forecast, sodium amber = truth
// (ERA5 reference), oxidized teal for cool data, and a model palette drawn from
// the same warm-cool spectrum rather than the default Tailwind hues.
export const AGG_COLOR = "#e8826b"; // coral — aggregate forecast (--color-aggregate-400)
export const TRUTH_COLOR = "#f5b942"; // sodium amber — ERA5-Seamless truth (--color-truth-400)
export const BAND_SWATCH = "rgba(232, 130, 107, 0.45)"; // more visible coral for the legend chip
export const PRECIP_BAR_COLOR = "rgba(127, 184, 224, 0.65)"; // dusty rain blue
export const PRECIP_SPREAD_FILL = "rgba(186, 219, 247, 0.38)"; // pale rain blue — ±1σ spread band
export const BAND_FILL = "rgba(232, 130, 107, 0.16)"; // coral, low alpha — ±1σ band
export const TRUTH_AREA = "rgba(245, 185, 66, 0.12)"; // sodium, low alpha — precip truth fill
export const NIGHT_FILL = "rgba(120, 140, 200, 0.12)"; // cool marine wash — reads as night against the warm theme
export const NOW_LINE = "rgba(245, 185, 66, 0.85)"; // sodium, translucent — the "Now" marker line
export const TOOLTIP_BG = "rgba(10, 16, 24, 0.96)"; // near-ink, translucent — tooltip backdrop
export const STD_LABEL = "#94a3b8"; // slate — the ±σ readout in the tooltip

export const MODEL_PALETTE = ["#6dc6c2", "#9bb87a", "#bfa9d6", "#f0a285", "#7fb8e0", "#d99a1e", "#e8826b", "#9ddad6", "#c7b69a", "#a8c182", "#b88c8c"];
export const MODEL_OPACITY = 0.55;

/** ECharts font stack — mirrors --font-mono (canvas can't read the CSS var). */
export const CHART_FONT = "JetBrains Mono Variable, ui-monospace, monospace";
