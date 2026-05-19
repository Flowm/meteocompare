// WMO weather interpretation codes used by open-meteo.
// https://open-meteo.com/en/docs#weathervariables

export type SeveritySlug =
  | 'clear'
  | 'mostly_clear'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'storm'

const CODE_TABLE: Record<number, { slug: SeveritySlug; label: string }> = {
  0: { slug: 'clear', label: 'Clear' },
  1: { slug: 'mostly_clear', label: 'Mainly clear' },
  2: { slug: 'mostly_clear', label: 'Partly cloudy' },
  3: { slug: 'cloudy', label: 'Overcast' },
  45: { slug: 'fog', label: 'Fog' },
  48: { slug: 'fog', label: 'Rime fog' },
  51: { slug: 'drizzle', label: 'Light drizzle' },
  53: { slug: 'drizzle', label: 'Drizzle' },
  55: { slug: 'drizzle', label: 'Dense drizzle' },
  56: { slug: 'drizzle', label: 'Freezing drizzle' },
  57: { slug: 'drizzle', label: 'Heavy freezing drizzle' },
  61: { slug: 'rain', label: 'Light rain' },
  63: { slug: 'rain', label: 'Rain' },
  65: { slug: 'rain', label: 'Heavy rain' },
  66: { slug: 'rain', label: 'Freezing rain' },
  67: { slug: 'rain', label: 'Heavy freezing rain' },
  71: { slug: 'snow', label: 'Light snow' },
  73: { slug: 'snow', label: 'Snow' },
  75: { slug: 'snow', label: 'Heavy snow' },
  77: { slug: 'snow', label: 'Snow grains' },
  80: { slug: 'rain', label: 'Light rain showers' },
  81: { slug: 'rain', label: 'Rain showers' },
  82: { slug: 'rain', label: 'Violent rain showers' },
  85: { slug: 'snow', label: 'Light snow showers' },
  86: { slug: 'snow', label: 'Snow showers' },
  95: { slug: 'storm', label: 'Thunderstorm' },
  96: { slug: 'storm', label: 'Thunderstorm with hail' },
  99: { slug: 'storm', label: 'Severe thunderstorm' },
}

const SEVERITY_ORDER: SeveritySlug[] = [
  'clear',
  'mostly_clear',
  'cloudy',
  'fog',
  'drizzle',
  'rain',
  'snow',
  'storm',
]

export function severitySlug(code: number): SeveritySlug {
  return CODE_TABLE[code]?.slug ?? 'cloudy'
}

export function severityRank(slug: SeveritySlug): number {
  return SEVERITY_ORDER.indexOf(slug)
}

export function weatherLabel(code: number): string {
  return CODE_TABLE[code]?.label ?? 'Unknown'
}

export function isKnownCode(code: number): boolean {
  return code in CODE_TABLE
}

export const ALL_KNOWN_CODES = Object.keys(CODE_TABLE).map(Number)
