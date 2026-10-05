import { HttpShifterApi } from './http';
import { MockShifterApi } from './mock';
import type { ShifterApi } from './types';

export type { ShifterApi } from './types';
export { ApiError } from './types';

/**
 * Single place that decides which backend the extension talks to: the live
 * Shifter API, or the in-memory mock when built with WXT_USE_MOCK=true
 * (`npm run build:mock`, used by `preview:ui`).
 */
export const USE_MOCK = import.meta.env.WXT_USE_MOCK === 'true';

/** Test builds only (build-test/): point the live client at a stand-in API. */
const BASE_URL_OVERRIDE = import.meta.env.WXT_SHIFTER_BASE_URL || undefined;

export const api: ShifterApi = USE_MOCK ? new MockShifterApi() : new HttpShifterApi(BASE_URL_OVERRIDE);
