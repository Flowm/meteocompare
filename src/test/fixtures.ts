// Shared test scaffolding — the small factories that several *.test.ts files
// had each hand-rolled (an AggregatePoint builder, a synthetic time axis, the
// Paris coords, the four-model subset, an `array` helper, and a fake Response).
// Source-typed and kept OUT of the `src/**/*.test.ts` vitest glob — the
// testFakeIdb.ts precedent — so it is shared and still type-checked by the
// tsconfig `src` include, but never collected as a test suite of its own.

import type { AggregatePoint } from "@/domain/aggregate";
import { getModel, type ModelDef } from "@/domain/models";

/** Paris — the neutral location the aggregate/weighting/aggregateVariables
 *  tests share. Inside meteofrance_seamless's home region, so its region bonus
 *  is exercised without any test having to know the box. */
export const PARIS = { lat: 48.85, lon: 2.35 };

/** The four-model subset the aggregate + aggregateVariables suites weight over:
 *  a global spread (ECMWF, GFS, ICON) plus the French CAM. Rebuilt per import so
 *  no suite can mutate a shared array. */
export const modelSubset = (): ModelDef[] => [getModel("ecmwf_ifs")!, getModel("gfs_seamless")!, getModel("icon_global")!, getModel("meteofrance_seamless")!];

export function array<T>(n: number, fn: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => fn(i));
}

/** A synthetic hourly time axis: `n` location-local ISO strings (no TZ suffix,
 *  minute precision) one hour apart from `baseISO`. Matches open-meteo's hourly
 *  `time` shape. */
export function makeTimes(n: number, baseISO: string): string[] {
  const base = new Date(baseISO).getTime();
  return array(n, (i) => new Date(base + i * 3_600_000).toISOString().slice(0, 16));
}

/** Build an AggregatePoint. `value` is `number | null` now (the honest "no data
 *  here" value), so the factory is null-aware. `perModel`/`weights` default to
 *  empty — the verification/scorecard/predictability paths that consume points
 *  only read `value`/`stdDev`/`time` unless a test supplies more. */
export function aggPoint(
  value: number | null,
  opts: { time?: string; stdDev?: number; weights?: Record<string, number>; perModel?: Record<string, number | null> } = {},
): AggregatePoint {
  return { time: opts.time ?? "", value, stdDev: opts.stdDev ?? 0, weights: opts.weights ?? {}, perModel: opts.perModel ?? {} };
}

/** A minimal fake Response covering the two shapes the API-client tests need:
 *  a `status` (with `ok` derived, or forced), an optional text body, and a
 *  header lookup (only `Retry-After` is ever read). Not spec-complete — just the
 *  surface fetchOpenMeteo / fetchOpenMeteoJson / fetchSingleRuns touch. */
export function fakeResponse(opts: { status?: number; ok?: boolean; body?: string; statusText?: string; headers?: Record<string, string> }): Response {
  const status = opts.status ?? 200;
  const ok = opts.ok ?? (status >= 200 && status < 300);
  const headers = opts.headers ?? {};
  return {
    status,
    ok,
    statusText: opts.statusText ?? (ok ? "OK" : "Error"),
    headers: { get: (k: string): string | null => headers[Object.keys(headers).find((h) => h.toLowerCase() === k.toLowerCase()) ?? ""] ?? null },
    text: () => Promise.resolve(opts.body ?? ""),
    json: () => Promise.resolve(opts.body ? JSON.parse(opts.body) : {}),
  } as unknown as Response;
}
