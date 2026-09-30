import { useCallback, useEffect, useState } from 'react';
import type { WxtStorageItem } from '#imports';

/**
 * Binds a WXT storage item to React state. Stays in sync with writes from
 * the background worker or another open popup/options page.
 * `ready` flips once the persisted value has been read.
 */
export function useStorageItem<T>(item: WxtStorageItem<T, Record<string, unknown>>) {
  const [value, setValue] = useState<T>(item.fallback);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    item.getValue().then((v) => {
      if (!alive) return;
      setValue(v);
      setReady(true);
    });
    const unwatch = item.watch((v) => setValue(v ?? item.fallback));
    return () => {
      alive = false;
      unwatch();
    };
  }, [item]);

  const update = useCallback(
    async (next: T) => {
      setValue(next);
      await item.setValue(next);
    },
    [item],
  );

  return [value, update, ready] as const;
}
