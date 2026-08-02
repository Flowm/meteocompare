import { useLocalStorage } from "@vueuse/core";
import { computed, watch, type Ref } from "vue";
import { useRoute, useRouter } from "vue-router";

export interface Location {
  name: string;
  /** Optional admin label, e.g. "Tyrol, AT" */
  detail?: string;
  latitude: number;
  longitude: number;
  country_code?: string;
  timezone?: string;
}

const DEFAULT_LOCATION: Location = {
  name: "Munich",
  detail: "Bavaria, DE",
  latitude: 48.1374,
  longitude: 11.5755,
  country_code: "DE",
  timezone: "Europe/Berlin",
};

export function useLocation() {
  const route = useRoute();
  const router = useRouter();

  const favourites = useLocalStorage<Location[]>("meteocompare:favorites", []);
  const recent = useLocalStorage<Location[]>("meteocompare:recent", []);

  /** Source of truth = URL. If absent, fall back to the most recent / default. */
  const current = computed<Location>(() => {
    const { lat, lon, name, detail, cc, tz } = route.query;
    if (lat && lon && name) {
      const parsedLat = Number(lat);
      const parsedLon = Number(lon);
      if (!Number.isNaN(parsedLat) && !Number.isNaN(parsedLon)) {
        return {
          name: String(name),
          detail: detail ? String(detail) : undefined,
          latitude: parsedLat,
          longitude: parsedLon,
          country_code: cc ? String(cc) : undefined,
          timezone: tz ? String(tz) : undefined,
        };
      }
    }
    return recent.value[0] ?? DEFAULT_LOCATION;
  });

  function setLocation(loc: Location): void {
    void router.push({
      query: {
        lat: loc.latitude.toFixed(4),
        lon: loc.longitude.toFixed(4),
        name: loc.name,
        ...(loc.detail ? { detail: loc.detail } : {}),
        ...(loc.country_code ? { cc: loc.country_code } : {}),
        ...(loc.timezone ? { tz: loc.timezone } : {}),
      },
    });
  }

  function rememberRecent(loc: Location): void {
    const without = recent.value.filter((r) => !sameLocation(r, loc));
    recent.value = [loc, ...without].slice(0, 8);
  }

  function isFavourite(loc: Location): boolean {
    return favourites.value.some((f) => sameLocation(f, loc));
  }

  function toggleFavourite(loc: Location): void {
    if (isFavourite(loc)) {
      favourites.value = favourites.value.filter((f) => !sameLocation(f, loc));
    } else {
      favourites.value = [...favourites.value, loc];
    }
  }

  watch(
    current,
    (loc) => {
      if (route.query.lat && route.query.lon) rememberRecent(loc);
    },
    { immediate: true },
  );

  const label = computed(() => locationLabel(current.value));

  return {
    current: current as Readonly<Ref<Location>>,
    label,
    favourites,
    recent,
    setLocation,
    isFavourite,
    toggleFavourite,
  };
}

/** A location's display label: `"Name, Detail"`, or the bare name when it has
 *  no admin detail. The single home of the join the views share. */
export function locationLabel(loc: Location): string {
  return loc.detail ? `${loc.name}, ${loc.detail}` : loc.name;
}

export function sameLocation(a: Location, b: Location): boolean {
  return Math.abs(a.latitude - b.latitude) < 1e-3 && Math.abs(a.longitude - b.longitude) < 1e-3;
}
