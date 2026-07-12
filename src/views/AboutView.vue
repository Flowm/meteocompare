<script setup lang="ts">
// The instrument's field manual: what MeteoCompare is, how the blend and the
// predictability signal work, and which models ride along. Everything that can
// be derived from the domain layer (model registry, counts, providers) is —
// so the page tracks the code instead of drifting from it.
import { computed } from "vue";
import { useRoute } from "vue-router";

import { DEFAULT_CALIBRATION_META } from "@/analysis/defaultCalibration";
import { DEFAULT_WEIGHTS_META } from "@/analysis/defaultWeights";
import AppFooter from "@/components/AppFooter.vue";
import LocationBar from "@/components/LocationBar.vue";
import { TEMP_HIT_TOLERANCE_C, WET_DAY_THRESHOLD_MM } from "@/domain/calibration";
import { MODELS, type ModelKind } from "@/domain/models";
import { TIER_CUTOFFS } from "@/domain/predictability";
import { LEAD_BANDS } from "@/domain/scorecard";

import { computeBandVotes, VOTE_KIND_ORDER } from "./aboutWeights";

const GITHUB_URL = "https://github.com/Flowm/meteocompare";

// — §02 · default-weights diagram (ADR 0011): whose voice the blend listens to —
// Not the raw per-band multipliers (meaningless before normalisation) but the
// NORMALISED share of the aggregate vote each model class commands, per lead
// band. Computed live in ./aboutWeights from the shipped fit + registry, so the
// bars track a refit; see that module for the honest share derivation and the
// simplifying assumptions the caption states.
const BAND_VOTES = computeBandVotes();

// Class → label + fill, in the diagram's stacked order (short-range specialists
// left, long-horizon models right). Fills reuse the §05 fleet-dot palette.
const VOTE_CLASS_META: Record<ModelKind, { label: string; fill: string }> = {
  "regional-cam": { label: "Convection-allowing", fill: "var(--color-heat-400)" },
  "regional-mid": { label: "Regional mid-res", fill: "var(--color-cold-400)" },
  global: { label: "Global", fill: "var(--color-sodium-300)" },
  ai: { label: "AI", fill: "var(--color-rain-400)" },
  "ensemble-mean": { label: "Ensemble mean", fill: "var(--color-paper-300)" },
};
const VOTE_LEGEND = VOTE_KIND_ORDER.map((kind) => Object.assign({ kind }, VOTE_CLASS_META[kind]));

// One horizontal 100%-stacked bar per band; only classes with a vote render.
const VOTE_BARS = (BAND_VOTES ?? []).map((v) => ({
  label: v.band.label,
  range: `${v.band.start}–${v.band.end} h`,
  memberCount: v.memberCount,
  segments: VOTE_KIND_ORDER.map((kind) => Object.assign({ kind }, VOTE_CLASS_META[kind], v.byClass[kind])).filter((s) => s.share > 0),
}));

const votePct = (share: number): number => Math.round(share * 100);
// A segment earns an inline % label when it is wide enough not to clip; the
// per-class model count rides along only on the roomier ones.
const LABEL_MIN_SHARE = 0.1;
const COUNT_MIN_SHARE = 0.16;

const WEIGHTS_META = DEFAULT_WEIGHTS_META;
const WEIGHTS_PROVENANCE = WEIGHTS_META ? `fitted at ${WEIGHTS_META.locations.length} reference locations worldwide · ${WEIGHTS_META.generatedAt.slice(0, 10)}` : "";

const route = useRoute();
// Same convention as the header's view switcher: keep the location (and any
// other query state) when hopping from here into one of the instruments.
const preservedQuery = computed(() => ({ ...route.query }));

// — §02 · the three-step blend —
const METHOD_STEPS = [
  {
    n: "01",
    title: "Pick",
    body: "Each model declares a home region and a maximum useful lead time. For every timestep, models that don't cover the location — or whose horizon has run out — are dropped before any math happens.",
  },
  {
    n: "02",
    title: "Weigh",
    body: "Survivors start at weight 1. Regional specialists earn +0.2–0.3 on home turf, convection-allowing models get ×1.3 on precipitation, and each model carries a fitted per-lead-band multiplier — how those add up into who actually gets heard is charted below. Locally trained multipliers, if you've fitted any, apply on top.",
  },
  {
    n: "03",
    title: "Blend",
    body: "Weighted mean ± 1 σ per hour and variable. Wind direction is averaged on the circle, so 350° and 10° make 0° — not 180°. The weather icon is the severity-weighted majority vote.",
  },
];

// — §03 · predictability formula, verbatim from domain/predictability.ts —
// Rendered from a constant (not a <pre> literal) so the formatter can't
// re-indent the alignment away.
const FORMULA = ["spread = clamp(1 − σ / typicalSpread(lead), 0, 1)", "votes  = min(1, independentModels / 3)", "raw    = spread × votes"].join("\n");

// — §03 · calibration facts, drawn live from the domain + the shipped fit —
// (ADR 0008/0010). Tolerances, band labels, tier cutoffs and the built-in
// fit's metadata all come from code, so this section can't drift from it.
const pct = (x: number): number => Math.round(x * 100);
const CAL = DEFAULT_CALIBRATION_META;
const CAL_POINTS = CAL ? Object.values(CAL.points).reduce((a, b) => a + b, 0) : 0;
const BAND_LABELS = LEAD_BANDS.map((b) => b.label).join(" · ");
const HIT_TEMP = `within ±${TEMP_HIT_TOLERANCE_C} °C of the actual daily high`;
const HIT_PRECIP = `the right wet-or-dry call at ≥ ${WET_DAY_THRESHOLD_MM} mm/day`;

/** The resolution ladder, most specific tier first (ADR 0008/0010). */
const LADDER = [
  { n: "01", title: "Your location's fit", note: "curves trained here (or in reach) win, per variable and lead band" },
  { n: "02", title: "Device pool", note: "one fit across every location you've trained on this device" },
  {
    n: "03",
    title: "Built-in default",
    note: CAL
      ? `shipped with the app — ${CAL.locations.length} reference locations worldwide, ${CAL_POINTS} verified days, fitted ${CAL.generatedAt.slice(0, 10)}`
      : "shipped with the app",
  },
  { n: "04", title: "Raw agreement", note: "the uncalibrated formula above — only where no curve clears its data gate" },
];

// Tier chips per scale, from the live cutoffs.
const TIER_ROWS = [
  {
    scale: "calibrated · daily badges",
    chips: [
      { tone: "high", label: `high · ≥ ${pct(TIER_CUTOFFS.calibrated.high)} % verified` },
      { tone: "mid", label: `mid · ≥ ${pct(TIER_CUTOFFS.calibrated.mid)} %` },
      { tone: "low", label: `low · < ${pct(TIER_CUTOFFS.calibrated.mid)} % · coin-flip territory` },
    ],
  },
  {
    scale: "raw · hourly & unverified variables",
    chips: [
      { tone: "high", label: `high · ≥ ${pct(TIER_CUTOFFS.raw.high)} % · models agree` },
      { tone: "mid", label: `mid · ≥ ${pct(TIER_CUTOFFS.raw.mid)} % · mixed signals` },
      { tone: "low", label: `low · < ${pct(TIER_CUTOFFS.raw.mid)} % · genuinely uncertain` },
    ],
  },
] as const;

const TIER_CHIP_CLASS = {
  high: "border-predictability-high/40 bg-predictability-high/10 text-predictability-high",
  mid: "border-predictability-mid/40 bg-predictability-mid/10 text-predictability-mid",
  low: "border-predictability-low/40 bg-predictability-low/10 text-predictability-low",
} as const;

// — §04 · the three instruments —
const VIEWS = [
  {
    path: "/",
    name: "Forecast",
    blurb:
      "The daily strip and hourly chart for the aggregate: temperature with its ±1 σ band, precipitation bars, predictability badges. Flip on the overlay to see every model's own line.",
  },
  {
    path: "/verify",
    name: "Verify",
    blurb: "Time-travel QA. Replay any archived model run against ERA5 reanalysis truth: per-model scorecards, bias and MAE, and an hour-by-hour rain hit / miss strip.",
  },
  {
    path: "/train",
    name: "Train",
    blurb:
      "Fit per-location weight multipliers from runs you've gathered and stored on-device — calibration curves for the predictability signal ride along on every fit. If the weights beat the heuristics on held-out runs, opt in and the aggregate uses them.",
  },
];

const SPEC: Array<[string, string]> = [
  ["models", `${MODELS.length} forecast products, auto-selected per location and lead time`],
  ["variables", "temperature · precipitation · precip probability · wind · cloud cover"],
  ["windows", "24 h · 3 d · 7 d on every chart"],
  ["overlay", "one trace per contributing model, individually toggleable"],
  ["verification", "past runs vs ERA5-Seamless reanalysis — scorecards, bias, rain timing"],
  ["training", "on-device weight fitting per location, strictly opt-in"],
  ["locations", "geocoding search · GPS · favourites — the URL is shareable state"],
  ["units", "°C ⇄ °F · mm ⇄ in · km/h ⇄ mph, persisted"],
  ["offline", "installable PWA; a service worker keeps the shell and last data cached"],
  ["api key", "optional open-meteo commercial key, stored only in your browser"],
];

// — §05 · fleet manifest, straight from the registry —
const KIND_ORDER: ModelKind[] = ["global", "regional-mid", "regional-cam", "ai", "ensemble-mean"];
const KIND_META: Record<ModelKind, { label: string; note: string; dot: string }> = {
  global: { label: "Global NWP", note: "whole-planet physics, the medium-range backbone", dot: "bg-sodium-300" },
  "regional-mid": { label: "Regional mid-res", note: "sharper resolution over a home region", dot: "bg-cold-400" },
  "regional-cam": { label: "Convection-allowing", note: "km-scale, resolves individual showers", dot: "bg-heat-400" },
  ai: { label: "AI forecast", note: "machine-learned emulators, long horizons", dot: "bg-rain-400" },
  "ensemble-mean": { label: "Ensemble mean", note: "the calm average of a perturbed ensemble", dot: "bg-paper-300" },
};
const fleet = computed(() => KIND_ORDER.map((kind) => Object.assign({ kind, models: MODELS.filter((m) => m.kind === kind) }, KIND_META[kind])));

// — §07 · every centre whose model output flows into the aggregate —
const providerList = computed(() => [...new Set(MODELS.map((m) => m.provider))].join(", "));

const FINE_PRINT = [
  {
    n: "01",
    body: "Static weights by default. Without local training there is no bias correction — a model that systematically runs cold in your valley passes that bias straight into the aggregate.",
  },
  {
    n: "02",
    body: "Deterministic runs only. The predictability signal reads agreement between single model runs, not true ensemble spread. Daily badges are calibrated against verified outcomes; hourly surfaces remain a raw agreement proxy, and a chaotic day can still read calm.",
  },
  {
    n: "03",
    body: "Verification truth (ERA5-Seamless) is scored for temperature and precipitation only, and lags real time by about five days.",
  },
  {
    n: "04",
    body: "Informational only — not a forecast of record. For severe-weather decisions, consult your national weather service.",
  },
];

const TECH = ["Vue 3", "TypeScript", "Tailwind CSS", "ECharts", "Vitest", "Cloudflare Workers"];
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <LocationBar />

    <main class="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <!-- Masthead ------------------------------------------------------- -->
      <section class="pt-2 pb-10 sm:pt-6 sm:pb-16">
        <p class="eyebrow-sodium rise rise-1">Field manual · MeteoCompare</p>
        <h1 class="rise rise-2 text-paper-50 mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
          One model is an opinion.<br />
          <span class="text-sodium-300 sodium-glow">{{ MODELS.length }} models</span> are a signal.
        </h1>
        <p class="rise rise-3 text-paper-200 mt-5 max-w-[62ch] text-sm leading-relaxed sm:text-base">
          MeteoCompare runs every public forecast model that covers your location — global physics cores, kilometre-scale regional models, AI emulators — through one weighted
          aggregate, and puts their disagreement on the chart instead of hiding it.
        </p>
        <dl class="rise rise-4 mt-7 flex flex-wrap gap-x-10 gap-y-3">
          <div>
            <dt class="text-paper-400 font-mono text-[10px] tracking-[0.18em] uppercase">Models blended</dt>
            <dd class="numeric text-sodium-300 mt-0.5 text-xl">{{ MODELS.length }}</dd>
          </div>
          <div>
            <dt class="text-paper-400 font-mono text-[10px] tracking-[0.18em] uppercase">Spread on the chart</dt>
            <dd class="numeric text-sodium-300 mt-0.5 text-xl">±1 σ</dd>
          </div>
          <div>
            <dt class="text-paper-400 font-mono text-[10px] tracking-[0.18em] uppercase">Servers of our own</dt>
            <dd class="numeric text-sodium-300 mt-0.5 text-xl">0</dd>
          </div>
        </dl>
      </section>

      <div class="space-y-12 sm:space-y-16">
        <!-- §01 · Purpose ------------------------------------------------ -->
        <section>
          <header class="mb-4 flex items-center gap-3 sm:mb-5">
            <span class="text-sodium-300 font-mono text-xs">§01</span>
            <h2 class="text-paper-50 text-lg font-semibold tracking-tight sm:text-xl">Why this exists</h2>
            <span class="bg-ink-700 h-px min-w-6 flex-1" aria-hidden="true" />
          </header>
          <div class="text-paper-200 max-w-[62ch] space-y-4 text-sm leading-relaxed sm:text-base">
            <p>
              A weather app gives you one confident number: 14°, light rain at noon. What it won't tell you is that one model put that rain at nine, another kept the morning dry,
              and a third saw twice the amount. The single number hides the thing you actually need for planning — how much anyone should trust it.
            </p>
            <p>
              Comparing models is the first thing a forecaster does on a tricky day. MeteoCompare automates the habit: for any place on Earth it fetches every model with coverage
              from open-meteo.com, weighs each one by how much it has earned a say here and now, and draws the blend with its uncertainty attached.
            </p>
            <p>
              There is no MeteoCompare backend and no account. Forecasts come straight from open-meteo, the aggregation runs in your browser, and the URL carries the state — a
              forecast you can bookmark, share, and install as an app.
            </p>
          </div>
        </section>

        <!-- §02 · Method ------------------------------------------------- -->
        <section>
          <header class="mb-4 flex items-center gap-3 sm:mb-5">
            <span class="text-sodium-300 font-mono text-xs">§02</span>
            <h2 class="text-paper-50 text-lg font-semibold tracking-tight sm:text-xl">How the blend works</h2>
            <span class="bg-ink-700 h-px min-w-6 flex-1" aria-hidden="true" />
          </header>
          <div class="grid gap-3 sm:grid-cols-3">
            <div v-for="s in METHOD_STEPS" :key="s.n" class="border-ink-700 bg-ink-900/60 border p-4">
              <p class="text-sodium-300 font-mono text-[10px] tracking-[0.18em]">{{ s.n }}</p>
              <h3 class="text-paper-50 mt-1.5 text-sm font-semibold tracking-tight">{{ s.title }}</h3>
              <p class="text-paper-300 mt-2 text-xs leading-relaxed">{{ s.body }}</p>
            </div>
          </div>

          <!-- Fitted default weights (ADR 0011), reframed as SHARE OF THE VOTE:
               one horizontal 100%-stacked bar per lead band, class-coloured, its
               segments the normalised share each model class commands of the
               blend at that lead. Computed live in ./aboutWeights from the shipped
               fit + registry, so the bars track a refit. Deliberately HTML (not
               the SVG the other figures use): a viewBox would scale the labels
               down with the container, and this must stay legible at ~375 px. -->
          <figure v-if="VOTE_BARS.length" class="registration border-ink-700 bg-ink-900/60 mt-5 border p-4 sm:p-5">
            <figcaption class="eyebrow">Whose voice the blend listens to</figcaption>
            <p class="text-paper-400 mt-1 mb-4 text-xs leading-relaxed">Share of the aggregate vote by model class, from day 1 to day 10.</p>

            <!-- Legend -->
            <div class="mb-5 flex flex-wrap gap-x-4 gap-y-1.5">
              <span v-for="c in VOTE_LEGEND" :key="c.kind" class="text-paper-200 flex items-center gap-1.5 font-mono text-[10px] tracking-wide">
                <span class="size-2.5 shrink-0" :style="{ backgroundColor: c.fill }" aria-hidden="true" />{{ c.label }}
              </span>
            </div>

            <!-- One 100%-stacked bar per band -->
            <div class="space-y-3.5">
              <div v-for="bar in VOTE_BARS" :key="bar.label">
                <div class="mb-1 flex items-baseline justify-between gap-2">
                  <span class="numeric text-paper-100 text-xs tracking-wide">{{ bar.label }}</span>
                  <span class="numeric text-paper-500 text-[10px]">{{ bar.range }} · {{ bar.memberCount }} models</span>
                </div>
                <div
                  class="ring-ink-700 flex h-9 w-full overflow-hidden ring-1"
                  role="img"
                  :aria-label="`${bar.label}: ${bar.segments.map((s) => `${s.label} ${votePct(s.share)} percent, ${s.count} model${s.count === 1 ? '' : 's'}`).join('; ')}`"
                >
                  <div
                    v-for="s in bar.segments"
                    :key="s.kind"
                    class="flex flex-col items-center justify-center overflow-hidden leading-none"
                    :style="{ flexGrow: s.share, flexBasis: 0, backgroundColor: s.fill }"
                    :title="`${s.label} · ${votePct(s.share)}% · ${s.count} model${s.count === 1 ? '' : 's'}`"
                  >
                    <span v-if="s.share >= LABEL_MIN_SHARE" class="numeric text-ink-950 text-[11px] font-semibold">{{ votePct(s.share) }}%</span>
                    <span v-if="s.share >= COUNT_MIN_SHARE" class="numeric text-ink-950/70 text-[9px]">{{ s.count }}×</span>
                  </div>
                </div>
              </div>
            </div>

            <p class="text-paper-400 mt-5 text-xs leading-relaxed">
              Convection-allowing and regional models carry the early bands, then drop off the roster as their horizon runs out; global physics and AI emulators own the long range.
              Read at each band's midpoint lead for a location with no home-region bonus and no precipitation boost, full roster present — an illustration of the shape, not the
              exact weights at your location.
            </p>
            <p class="text-paper-500 mt-2 text-xs leading-relaxed">
              {{ WEIGHTS_PROVENANCE }} — a single pooled default, not a per-place fit. Every model carries its own fitted multiplier; a model the fit has never seen (or a class
              band too thin to fit) falls back to its model class, then to a neutral 1.0. Weights you train on the
              <RouterLink to="/train" class="text-sodium-200 underline-offset-4 hover:underline">Train</RouterLink> page multiply on top of these defaults — this chart is the
              untrained baseline every location starts from.
            </p>
          </figure>
        </section>

        <!-- §03 · Predictability ----------------------------------------- -->
        <section>
          <header class="mb-4 flex items-center gap-3 sm:mb-5">
            <span class="text-sodium-300 font-mono text-xs">§03</span>
            <h2 class="text-paper-50 text-lg font-semibold tracking-tight sm:text-xl">The predictability signal</h2>
            <span class="bg-ink-700 h-px min-w-6 flex-1" aria-hidden="true" />
          </header>
          <div class="text-paper-200 max-w-[62ch] space-y-4 text-sm leading-relaxed sm:text-base">
            <p>
              The signal starts as agreement made visible. For each hour the app measures how widely the models spread, normalises that against typical spread at the same lead
              time, and discounts votes that aren't independent — sibling models sharing a dynamical core count about a quarter each. Weather icons, which have no meaningful σ, use
              severity-group agreement instead.
            </p>
          </div>
          <figure class="registration border-ink-700 bg-ink-900/60 mt-5 border">
            <div class="graph-paper overflow-x-auto p-4 sm:p-5">
              <pre class="text-paper-100 font-mono text-xs leading-6">{{ FORMULA }}</pre>
            </div>
          </figure>
          <div class="text-paper-200 mt-5 max-w-[62ch] space-y-4 text-sm leading-relaxed sm:text-base">
            <p>
              Agreement alone can lie — related models agree and are wrong together, and a raw 30 % says nothing about how often such days actually verify. So on the daily badges
              the raw score is <em>calibrated</em>: the app looks up how often past forecasts with agreement like this turned out close enough — {{ HIT_TEMP }}, or
              {{ HIT_PRECIP }} — and publishes that verified frequency instead. Curves are fitted separately per lead-time band ({{ BAND_LABELS }}), because a day-one and a day-six
              forecast live in different error regimes. Each day card then shows the lower of its temperature and rain values — a day is only as trustworthy as its least certain
              headline — and clicking the badge splits them apart.
            </p>
            <p>Where the number comes from is resolved down a ladder; the first tier with enough verified days for the band wins:</p>
          </div>
          <figure class="registration border-ink-700 bg-ink-900/60 mt-5 border p-4 sm:p-5">
            <figcaption class="eyebrow mb-3">Calibration ladder · most local evidence wins</figcaption>
            <ol class="space-y-2">
              <li v-for="step in LADDER" :key="step.n" class="flex items-baseline gap-3">
                <span class="text-sodium-300/80 font-mono text-[10px] tracking-wide">{{ step.n }}</span>
                <span class="text-paper-100 min-w-[10rem] text-sm font-medium tracking-tight">{{ step.title }}</span>
                <span class="text-paper-400 text-xs leading-relaxed">{{ step.note }}</span>
              </li>
            </ol>
          </figure>
          <div class="mt-4 space-y-2.5">
            <div v-for="row in TIER_ROWS" :key="row.scale">
              <p class="text-paper-500 mb-1.5 font-mono text-[10px] tracking-[0.18em] uppercase">{{ row.scale }}</p>
              <div class="flex flex-wrap gap-2">
                <span v-for="chip in row.chips" :key="chip.label" class="border px-2.5 py-1 font-mono text-[11px] tracking-wide" :class="TIER_CHIP_CLASS[chip.tone]">{{
                  chip.label
                }}</span>
              </div>
            </div>
          </div>
          <p class="text-paper-400 mt-4 max-w-[62ch] text-xs leading-relaxed">
            Honest caveats: calibration fixes the <em>rate</em>, not the ranking — mid-range agreement barely separates one day from the next, so most of the signal comes from lead
            time. It is measured against ERA5 reanalysis, not your garden thermometer. And with no ensemble members in the mix, a chaotic day on which the models happen to agree
            still reads calmer than it is. Hourly surfaces and unverified variables show the raw score, labelled as such.
          </p>
        </section>

        <!-- §04 · The three instruments ---------------------------------- -->
        <section>
          <header class="mb-4 flex items-center gap-3 sm:mb-5">
            <span class="text-sodium-300 font-mono text-xs">§04</span>
            <h2 class="text-paper-50 text-lg font-semibold tracking-tight sm:text-xl">Three instruments</h2>
            <span class="bg-ink-700 h-px min-w-6 flex-1" aria-hidden="true" />
          </header>
          <div class="grid gap-3 sm:grid-cols-3">
            <RouterLink
              v-for="v in VIEWS"
              :key="v.path"
              :to="{ path: v.path, query: preservedQuery }"
              class="group border-ink-700 bg-ink-900/60 hover:border-sodium-300/60 block border p-4 transition-colors"
            >
              <p class="text-paper-500 font-mono text-[10px] tracking-wide">{{ v.path }}</p>
              <h3 class="text-paper-50 mt-1.5 flex items-baseline justify-between gap-2 text-sm font-semibold tracking-tight">
                {{ v.name }}
                <span class="text-sodium-300 font-mono text-xs opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true">→</span>
              </h3>
              <p class="text-paper-300 mt-2 text-xs leading-relaxed">{{ v.blurb }}</p>
            </RouterLink>
          </div>
          <div class="border-ink-700 bg-ink-900/40 mt-5 border p-4 sm:p-6">
            <p class="eyebrow mb-4">Also in the box</p>
            <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2.5 sm:gap-x-8">
              <template v-for="[k, v] in SPEC" :key="k">
                <dt class="text-sodium-300/90 pt-px font-mono text-[10px] tracking-[0.18em] uppercase">{{ k }}</dt>
                <dd class="text-paper-200 text-sm leading-snug">{{ v }}</dd>
              </template>
            </dl>
          </div>
        </section>

        <!-- §05 · Fleet manifest (rendered live from domain/models.ts) ---- -->
        <section>
          <header class="mb-4 flex items-center gap-3 sm:mb-5">
            <span class="text-sodium-300 font-mono text-xs">§05</span>
            <h2 class="text-paper-50 text-lg font-semibold tracking-tight sm:text-xl">The model fleet</h2>
            <span class="bg-ink-700 h-px min-w-6 flex-1" aria-hidden="true" />
          </header>
          <p class="text-paper-200 max-w-[62ch] text-sm leading-relaxed sm:text-base">
            The registry, drawn live from the app's model table — {{ MODELS.length }} products across five classes. Membership is automatic: each model contributes only inside its
            coverage and only as far as its horizon carries.
          </p>
          <div class="border-ink-700 bg-ink-900/40 mt-5 border p-4 sm:p-6">
            <div v-for="g in fleet" :key="g.kind" class="mt-6 first:mt-0">
              <div class="mb-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                <span class="size-1.5 self-center rounded-full" :class="g.dot" aria-hidden="true" />
                <h3 class="text-paper-100 font-mono text-xs tracking-[0.18em] uppercase">{{ g.label }}</h3>
                <span class="text-paper-500 font-mono text-[10px]">× {{ g.models.length }}</span>
                <span class="text-paper-400 text-xs">— {{ g.note }}</span>
              </div>
              <div v-for="m in g.models" :key="m.id" class="hairline-t grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-2 sm:grid-cols-[11.5rem_minmax(0,1fr)_4.5rem]">
                <span class="text-paper-50 col-start-1 row-start-1 text-sm">{{ m.label }}</span>
                <p class="text-paper-300 col-span-full row-start-2 text-xs leading-relaxed sm:col-span-1 sm:col-start-2 sm:row-start-1">{{ m.description }}</p>
                <span class="numeric text-paper-200 col-start-2 row-start-1 text-right text-xs sm:col-start-3">{{ m.maxLeadHours }} h</span>
              </div>
            </div>
          </div>
        </section>

        <!-- §06 · Fine print --------------------------------------------- -->
        <section>
          <header class="mb-4 flex items-center gap-3 sm:mb-5">
            <span class="text-sodium-300 font-mono text-xs">§06</span>
            <h2 class="text-paper-50 text-lg font-semibold tracking-tight sm:text-xl">The fine print</h2>
            <span class="bg-ink-700 h-px min-w-6 flex-1" aria-hidden="true" />
          </header>
          <ul class="max-w-[70ch] space-y-3">
            <li v-for="f in FINE_PRINT" :key="f.n" class="flex gap-3">
              <span class="text-sodium-300/80 pt-px font-mono text-[10px] tracking-wide">{{ f.n }}</span>
              <p class="text-paper-300 text-sm leading-relaxed">{{ f.body }}</p>
            </li>
          </ul>
        </section>

        <!-- §07 · Colophon ----------------------------------------------- -->
        <section>
          <header class="mb-4 flex items-center gap-3 sm:mb-5">
            <span class="text-sodium-300 font-mono text-xs">§07</span>
            <h2 class="text-paper-50 text-lg font-semibold tracking-tight sm:text-xl">Colophon</h2>
            <span class="bg-ink-700 h-px min-w-6 flex-1" aria-hidden="true" />
          </header>
          <div class="text-paper-200 max-w-[62ch] space-y-4 text-sm leading-relaxed sm:text-base">
            <p>
              Forecast data by
              <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" class="text-sodium-200 underline-offset-4 hover:underline">open-meteo.com</a>
              (CC BY 4.0) — the generous, CORS-friendly API that makes a backend-less design possible. Icons from Erik Flowers'
              <a href="https://github.com/erikflowers/weather-icons" target="_blank" rel="noopener noreferrer" class="text-sodium-200 underline-offset-4 hover:underline"
                >weather-icons</a
              >.
            </p>
            <p>
              None of this exists without the numerical weather prediction community: {{ providerList }}. open-meteo redistributes their open model output; MeteoCompare just reads
              it carefully.
            </p>
          </div>
          <div class="mt-5 flex flex-wrap items-center gap-2">
            <span v-for="t in TECH" :key="t" class="border-ink-700 text-paper-300 border px-2 py-0.5 font-mono text-[10px] tracking-wide">{{ t }}</span>
            <a
              :href="GITHUB_URL"
              target="_blank"
              rel="noopener noreferrer"
              class="border-sodium-300/40 bg-sodium-300/10 text-sodium-200 hover:bg-sodium-300/20 border px-2 py-0.5 font-mono text-[10px] tracking-wide transition-colors"
              >source on GitHub →</a
            >
          </div>
        </section>
      </div>
    </main>

    <AppFooter>Multi-model aggregate, informational only</AppFooter>
  </div>
</template>

<style scoped>
/* Masthead reveal — a single staggered rise on load, nothing on scroll. */
@media (prefers-reduced-motion: no-preference) {
  .rise {
    animation: rise 640ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .rise-1 {
    animation-delay: 40ms;
  }
  .rise-2 {
    animation-delay: 120ms;
  }
  .rise-3 {
    animation-delay: 220ms;
  }
  .rise-4 {
    animation-delay: 320ms;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
}
</style>
