import { afterEach, describe, expect, it, vi } from "vitest";

import { evaluateRun } from "@/analysis/runEvaluation";
import type { HistoricalWeatherResponse } from "@/api/omHistoricalWeather";
import { fakeResponse } from "@/test/fixtures";

import { fetchSingleRuns } from "./omSingleRuns";

const REQ = { lat: 48.2, lon: 16.4, runDate: "2026-05-12", models: ["ecmwf_ifs", "icon_global", "jma_seamless"] };

/** Build a fake Response in one of three shapes:
 *  - ok: a 200 with a trivial valid body.
 *  - model: a clean JSON 4xx ("...Model: <model>, run: ...") — small batches.
 *  - stream: a 200 whose body is a mid-stream plain-text abort naming
 *    `App.DomainRegistry.<model>` — what large batches actually return. */
function res(opts: { ok: boolean; model?: string; stream?: boolean }): Response {
  let body: string;
  let status: number;
  if (opts.ok) {
    body = JSON.stringify({ hourly: { time: [] } });
    status = 200;
  } else if (opts.stream) {
    body = `Unexpected error while streaming data: modelRunUnavailable(model: App.DomainRegistry.${opts.model}, run: App.Timestamp(timeIntervalSince1970: 1778544000))`;
    status = 200; // status committed before the stream aborted
  } else {
    body = JSON.stringify({ error: true, reason: `The requested model run is not available. Model: ${opts.model}, run: 2026-05-12T00:00Z` });
    status = 400;
  }
  return {
    ok: status === 200,
    status,
    statusText: status === 200 ? "OK" : "Bad Request",
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

/** The `models=` value of the URL passed to the nth fetch call. */
function modelsOf(mock: ReturnType<typeof vi.fn>, call: number): string[] {
  const url = new URL(mock.mock.calls[call]?.[0] as string);
  return (url.searchParams.get("models") ?? "").split(",");
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchSingleRuns adaptive retry", () => {
  it.each([false, true])("preserves bare single-model data through evaluation (after retry: %s)", async (retry) => {
    const time = Array.from({ length: 24 }, (_, i) => `2026-05-12T${String(i).padStart(2, "0")}:00`);
    const hourly = { time, temperature_2m: time.map(() => 12), precipitation: time.map(() => 0) };
    const fetchMock = vi.fn();
    if (retry) fetchMock.mockResolvedValueOnce(res({ ok: false, model: "dwd_icon" }));
    fetchMock.mockResolvedValueOnce(fakeResponse({ body: JSON.stringify({ hourly, hourly_units: { temperature_2m: "°C", precipitation: "mm" } }) }));
    vi.stubGlobal("fetch", fetchMock);
    const runs = await fetchSingleRuns({ ...REQ, models: retry ? ["ecmwf_ifs", "icon_global"] : ["ecmwf_ifs"] });
    const ev = evaluateRun({ runs, truth: { hourly } as HistoricalWeatherResponse, lat: REQ.lat, lon: REQ.lon, runDate: REQ.runDate });
    expect(ev!.availableModels.map((m) => m.id)).toEqual(["ecmwf_ifs"]);
    expect(ev!.hourly.perModel.temperature_2m?.ecmwf_ifs).toEqual(hourly.temperature_2m);
    expect(ev!.daily[0]!.aggregate.temperature?.mae).toBe(0);
    expect(ev!.scorecard.find((row) => row.id === "ecmwf_ifs")?.overall.composite).toBe(100);
  });

  it("drops a model named in a 'run not available' error and retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res({ ok: false, model: "jma_gsm" }))
      .mockResolvedValueOnce(res({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSingleRuns(REQ);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // jma_gsm maps back to the registry id jma_seamless, which is dropped.
    expect(modelsOf(fetchMock, 0)).toContain("jma_seamless");
    expect(modelsOf(fetchMock, 1)).not.toContain("jma_seamless");
    expect(modelsOf(fetchMock, 1)).toEqual(["ecmwf_ifs", "icon_global"]);
  });

  it("handles the streamed 200 abort shape large batches return", async () => {
    // The real failure: a 200 whose body is plain-text "...modelRunUnavailable(
    // model: App.DomainRegistry.jma_gsm, ...)" rather than a clean JSON 4xx.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res({ ok: false, stream: true, model: "jma_gsm" }))
      .mockResolvedValueOnce(res({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSingleRuns(REQ);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(modelsOf(fetchMock, 1)).not.toContain("jma_seamless");
  });

  it("drops several missing models across successive retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res({ ok: false, model: "jma_gsm" }))
      .mockResolvedValueOnce(res({ ok: false, model: "dwd_icon" })) // icon_global's component
      .mockResolvedValueOnce(res({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSingleRuns(REQ);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(modelsOf(fetchMock, 2)).toEqual(["ecmwf_ifs"]);
  });

  it("resolves a location-specific seamless component to its registry id", async () => {
    // Inside France, meteofrance_seamless resolves to the AROME France HD 15-min
    // component, so a missing run names that component rather than the id we
    // sent. The provider-prefix fallback maps it back to meteofrance_seamless so
    // the batch drops one model and retries instead of failing wholesale.
    const req = { lat: 48.0, lon: 8.9, runDate: "2026-06-10", models: ["ecmwf_ifs", "meteofrance_seamless"] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res({ ok: false, stream: true, model: "meteofrance_arome_france_hd_15min" }))
      .mockResolvedValueOnce(res({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSingleRuns(req);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(modelsOf(fetchMock, 1)).toEqual(["ecmwf_ifs"]);
  });

  it("resolves a model that reports its own id directly", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res({ ok: false, model: "ecmwf_ifs" }))
      .mockResolvedValueOnce(res({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSingleRuns(REQ);

    expect(modelsOf(fetchMock, 1)).not.toContain("ecmwf_ifs");
  });

  it("propagates an error it cannot attribute to a requested model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({ ok: false, model: "some_unknown_model" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSingleRuns(REQ)).rejects.toThrow(/not available/);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no blind retry
  });

  it("does not retry past the last remaining model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({ ok: false, model: "ecmwf_ifs" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSingleRuns({ ...REQ, models: ["ecmwf_ifs"] })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rethrows an abort without retrying", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSingleRuns(REQ)).rejects.toThrow(/abort/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports each pruned model through onModelUnavailable (clean 4xx)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res({ ok: false, model: "jma_gsm" }))
      .mockResolvedValueOnce(res({ ok: false, model: "dwd_icon" })) // icon_global's component
      .mockResolvedValueOnce(res({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onModelUnavailable = vi.fn();

    await fetchSingleRuns(REQ, { onModelUnavailable });

    // The resolved registry ids, in drop order — so a gather can carry them forward.
    expect(onModelUnavailable.mock.calls.map((c) => c[0])).toEqual(["jma_seamless", "icon_global"]);
  });

  it("reports a pruned model from the streamed 200 abort shape", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res({ ok: false, stream: true, model: "jma_gsm" }))
      .mockResolvedValueOnce(res({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onModelUnavailable = vi.fn();

    await fetchSingleRuns(REQ, { onModelUnavailable });

    expect(onModelUnavailable).toHaveBeenCalledTimes(1);
    expect(onModelUnavailable).toHaveBeenCalledWith("jma_seamless");
  });

  it("reports the last remaining model before giving up", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({ ok: false, model: "ecmwf_ifs" }));
    vi.stubGlobal("fetch", fetchMock);
    const onModelUnavailable = vi.fn();

    // Can't retry past the last model, but the miss is still learned so older
    // runs of this cycle skip it too.
    await expect(fetchSingleRuns({ ...REQ, models: ["ecmwf_ifs"] }, { onModelUnavailable })).rejects.toThrow();
    expect(onModelUnavailable).toHaveBeenCalledTimes(1);
    expect(onModelUnavailable).toHaveBeenCalledWith("ecmwf_ifs");
  });
});
