import { useLocalStorage } from "@vueuse/core";

import { OPEN_METEO_API_KEY_STORAGE_KEY } from "@/api/openMeteo";

/** The optional open-meteo commercial API key, persisted to localStorage. A
 *  non-empty value routes every data request through open-meteo's `customer-`
 *  endpoints (see buildOpenMeteoUrl); empty means the free tier.
 *
 *  Exposed as a reactive ref so the settings UI can edit it and the data
 *  composables can list it as a fetch dependency — changing the key refetches. */
export function useApiKey() {
  const apiKey = useLocalStorage<string>(OPEN_METEO_API_KEY_STORAGE_KEY, "");
  return { apiKey };
}
