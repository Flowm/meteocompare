import { useLocalStorage } from "@vueuse/core";

/** App-wide forecast settings (persisted), separate from unit prefs (useUnits). */
export function useSettings() {
  /** Apply this location's trained weight multipliers to the live aggregate when
   *  available (see the training page + learnedWeights / ADR 0007). Off by
   *  default — the heuristic weighting is the honest default and fallback. */
  const useTrainedWeights = useLocalStorage<boolean>("meteocompare:use-trained-weights", false);
  return { useTrainedWeights };
}
