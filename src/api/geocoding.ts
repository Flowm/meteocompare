// Open-meteo geocoding API client.
// Docs: https://open-meteo.com/en/docs/geocoding-api

import { buildOpenMeteoUrl, fetchOpenMeteoJson } from "./openMeteo";

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";

export interface GeocodingResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  admin2?: string;
  feature_code?: string;
  timezone?: string;
  population?: number;
}

interface GeocodingResponse {
  results?: GeocodingResult[];
}

export async function searchLocations(query: string, signal?: AbortSignal, language: string = "en", count: number = 8): Promise<GeocodingResult[]> {
  if (query.trim().length < 2) return [];
  const params = new URLSearchParams({
    name: query.trim(),
    count: String(count),
    language,
    format: "json",
  });
  const url = buildOpenMeteoUrl(GEOCODING_URL, params);
  const data = await fetchOpenMeteoJson<GeocodingResponse>(url, "geocoding", signal);
  return data.results ?? [];
}

export function formatLocation(loc: GeocodingResult): string {
  const parts = [loc.name];
  if (loc.admin1 && loc.admin1 !== loc.name) parts.push(loc.admin1);
  if (loc.country_code) parts.push(loc.country_code);
  return parts.join(", ");
}
