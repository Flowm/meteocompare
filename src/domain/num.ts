// Small shared numeric helpers for the domain layer.

/** Clamp a value into the unit interval [0, 1]. */
export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
