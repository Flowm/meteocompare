// WMO weather interpretation codes used by open-meteo.
// https://open-meteo.com/en/docs#weathervariables
//
// Icons map onto Erik Flowers' weather-icons font (CSS classes `wi wi-…`).
// Each WMO code resolves to a day and a night class so we can switch via
// open-meteo's `is_day` flag.

export type SeveritySlug = "clear" | "mostly_clear" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";

export interface WeatherIconClasses {
  /** Class for daytime context, e.g. "wi-day-sunny". */
  day: string;
  /** Class for nighttime context, e.g. "wi-night-clear". */
  night: string;
  /** Tailwind text-color class hinting the icon tone. */
  tone: string;
}

interface CodeEntry {
  slug: SeveritySlug;
  label: string;
  icon: WeatherIconClasses;
}

// Tone palette: amber for sun, slate for clouds/fog, sky for rain,
// blue for snow, violet for thunder. Set on the <i> element via Tailwind.
const TONES = {
  sun: "text-amber-300",
  cloud: "text-slate-300",
  fog: "text-slate-400",
  rain: "text-sky-300",
  snow: "text-blue-200",
  storm: "text-violet-300",
} as const;

const CODE_TABLE: Record<number, CodeEntry> = {
  0: { slug: "clear", label: "Clear", icon: { day: "wi-day-sunny", night: "wi-night-clear", tone: TONES.sun } },
  1: { slug: "mostly_clear", label: "Mainly clear", icon: { day: "wi-day-sunny-overcast", night: "wi-night-partly-cloudy", tone: TONES.sun } },
  2: { slug: "mostly_clear", label: "Partly cloudy", icon: { day: "wi-day-cloudy", night: "wi-night-alt-cloudy", tone: TONES.cloud } },
  3: { slug: "cloudy", label: "Overcast", icon: { day: "wi-cloudy", night: "wi-cloudy", tone: TONES.cloud } },
  45: { slug: "fog", label: "Fog", icon: { day: "wi-fog", night: "wi-night-fog", tone: TONES.fog } },
  48: { slug: "fog", label: "Rime fog", icon: { day: "wi-fog", night: "wi-night-fog", tone: TONES.fog } },
  51: { slug: "drizzle", label: "Light drizzle", icon: { day: "wi-day-sprinkle", night: "wi-night-alt-sprinkle", tone: TONES.rain } },
  53: { slug: "drizzle", label: "Drizzle", icon: { day: "wi-day-sprinkle", night: "wi-night-alt-sprinkle", tone: TONES.rain } },
  55: { slug: "drizzle", label: "Dense drizzle", icon: { day: "wi-day-rain", night: "wi-night-alt-rain", tone: TONES.rain } },
  56: { slug: "drizzle", label: "Freezing drizzle", icon: { day: "wi-day-rain-mix", night: "wi-night-alt-rain-mix", tone: TONES.rain } },
  57: { slug: "drizzle", label: "Heavy freezing drizzle", icon: { day: "wi-day-rain-mix", night: "wi-night-alt-rain-mix", tone: TONES.rain } },
  61: { slug: "rain", label: "Light rain", icon: { day: "wi-day-rain", night: "wi-night-alt-rain", tone: TONES.rain } },
  63: { slug: "rain", label: "Rain", icon: { day: "wi-day-rain", night: "wi-night-alt-rain", tone: TONES.rain } },
  65: { slug: "rain", label: "Heavy rain", icon: { day: "wi-day-rain-wind", night: "wi-night-alt-rain-wind", tone: TONES.rain } },
  66: { slug: "rain", label: "Freezing rain", icon: { day: "wi-day-rain-mix", night: "wi-night-alt-rain-mix", tone: TONES.rain } },
  67: { slug: "rain", label: "Heavy freezing rain", icon: { day: "wi-day-rain-mix", night: "wi-night-alt-rain-mix", tone: TONES.rain } },
  71: { slug: "snow", label: "Light snow", icon: { day: "wi-day-snow", night: "wi-night-alt-snow", tone: TONES.snow } },
  73: { slug: "snow", label: "Snow", icon: { day: "wi-day-snow", night: "wi-night-alt-snow", tone: TONES.snow } },
  75: { slug: "snow", label: "Heavy snow", icon: { day: "wi-day-snow-wind", night: "wi-night-alt-snow-wind", tone: TONES.snow } },
  77: { slug: "snow", label: "Snow grains", icon: { day: "wi-snowflake-cold", night: "wi-snowflake-cold", tone: TONES.snow } },
  80: { slug: "rain", label: "Light rain showers", icon: { day: "wi-day-showers", night: "wi-night-alt-showers", tone: TONES.rain } },
  81: { slug: "rain", label: "Rain showers", icon: { day: "wi-day-showers", night: "wi-night-alt-showers", tone: TONES.rain } },
  82: { slug: "rain", label: "Violent rain showers", icon: { day: "wi-day-rain-wind", night: "wi-night-alt-rain-wind", tone: TONES.rain } },
  85: { slug: "snow", label: "Light snow showers", icon: { day: "wi-day-snow", night: "wi-night-alt-snow", tone: TONES.snow } },
  86: { slug: "snow", label: "Snow showers", icon: { day: "wi-day-snow-wind", night: "wi-night-alt-snow-wind", tone: TONES.snow } },
  95: { slug: "storm", label: "Thunderstorm", icon: { day: "wi-day-thunderstorm", night: "wi-night-alt-thunderstorm", tone: TONES.storm } },
  96: { slug: "storm", label: "Thunderstorm with hail", icon: { day: "wi-day-storm-showers", night: "wi-night-alt-storm-showers", tone: TONES.storm } },
  99: { slug: "storm", label: "Severe thunderstorm", icon: { day: "wi-day-thunderstorm", night: "wi-night-alt-thunderstorm", tone: TONES.storm } },
};

const FALLBACK_ICON: WeatherIconClasses = {
  day: "wi-na",
  night: "wi-na",
  tone: TONES.cloud,
};

export function iconFor(code: number): WeatherIconClasses {
  return CODE_TABLE[code]?.icon ?? FALLBACK_ICON;
}

const SEVERITY_ORDER: SeveritySlug[] = ["clear", "mostly_clear", "cloudy", "fog", "drizzle", "rain", "snow", "storm"];

export function severitySlug(code: number): SeveritySlug {
  return CODE_TABLE[code]?.slug ?? "cloudy";
}

export function severityRank(slug: SeveritySlug): number {
  return SEVERITY_ORDER.indexOf(slug);
}

export function weatherLabel(code: number): string {
  return CODE_TABLE[code]?.label ?? "Unknown";
}

export function isKnownCode(code: number): boolean {
  return code in CODE_TABLE;
}

export const ALL_KNOWN_CODES = Object.keys(CODE_TABLE).map(Number);
