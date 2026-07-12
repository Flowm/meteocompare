// The ADR-0010 reference set, shared by every offline fitting script
// (fit-default-calibration, fit-default-weights, run-weight-experiment).
//
// Climatically diverse — alpine, maritime, Mediterranean, Nordic, continental,
// monsoonal, equatorial, and southern-hemisphere members — so no single regime
// dominates a pooled fit.

export interface RefLocation {
  name: string;
  latitude: number;
  longitude: number;
}

export const REFERENCE_LOCATIONS: readonly RefLocation[] = [
  { name: "Munich", latitude: 48.1374, longitude: 11.5755 },
  { name: "London", latitude: 51.5072, longitude: -0.1276 },
  { name: "Lisbon", latitude: 38.7223, longitude: -9.1393 },
  { name: "Oslo", latitude: 59.9139, longitude: 10.7522 },
  { name: "New York", latitude: 40.7128, longitude: -74.006 },
  { name: "Denver", latitude: 39.7392, longitude: -104.9903 },
  { name: "Seattle", latitude: 47.6062, longitude: -122.3321 },
  { name: "Tokyo", latitude: 35.6762, longitude: 139.6503 },
  { name: "Singapore", latitude: 1.3521, longitude: 103.8198 },
  { name: "Sydney", latitude: -33.8688, longitude: 151.2093 },
  { name: "São Paulo", latitude: -23.5505, longitude: -46.6333 },
  { name: "Cape Town", latitude: -33.9249, longitude: 18.4241 },
];
