import { MockShifterApi } from './mock';
import type { ShifterApi } from './types';

export type { ShifterApi } from './types';
export { ApiError } from './types';

/**
 * Single place that decides which backend the extension talks to.
 * Replace with `new HttpShifterApi(...)` once the panel endpoints exist.
 */
export const api: ShifterApi = new MockShifterApi();
