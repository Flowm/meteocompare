import { addDaysIso } from "@/utils/date";

export const SINGLE_FORECAST_DAYS = 7;
export const TRAINING_FORECAST_DAYS = 10;
// ERA5's approximate five-day publication lag, plus one complete-day margin.
const TRUTH_DELAY_DAYS = 6;
export const TRAINING_RUN_DELAY_DAYS = TRAINING_FORECAST_DAYS + TRUTH_DELAY_DAYS;

export function latestVerifiableRunDate(today: string, forecastDays: number): string {
  return addDaysIso(today, -(forecastDays + TRUTH_DELAY_DAYS));
}
