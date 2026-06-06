import { useResizeObserver } from "@vueuse/core";
import { nextTick, onMounted, ref, watch, type Ref } from "vue";

/** Decides whether an expanded control rail fits on one line beside a sidecar
 *  control, collapsing to a dropdown when the two would wrap. Measures the
 *  off-layout `probe`'s natural width plus the `sidecar`'s against the `root`'s
 *  available width, re-measuring on resize of either and whenever
 *  `remeasureKey` changes (e.g. the rail's item set).
 *
 *  The element refs stay owned by the calling component (its template binds
 *  them); this helper only reads them. Returns the `expanded` flag. */
export function useFittingRail(root: Ref<HTMLElement | null>, probe: Ref<HTMLElement | null>, sidecar: Ref<HTMLElement | null>, remeasureKey: () => unknown): Ref<boolean> {
  const expanded = ref(true);

  const ROW_GAP = 12; // gap-3 between the rail and the sidecar

  function measure(): void {
    void nextTick(() => {
      const r = root.value;
      const p = probe.value;
      const s = sidecar.value;
      if (!r || !p || !s) return;
      expanded.value = p.offsetWidth + s.offsetWidth + ROW_GAP <= r.clientWidth;
    });
  }

  useResizeObserver(root, measure);
  useResizeObserver(sidecar, measure);
  onMounted(measure);
  watch(remeasureKey, measure);

  return expanded;
}
