import { useEffect, useState, type DependencyList } from 'react';

/** Minimal loader: re-runs when deps change, ignores stale responses. */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<{ data?: T; loading: boolean; error?: unknown }>({ loading: true });

  useEffect(() => {
    let alive = true;
    setState((s) => ({ data: s.data, loading: true }));
    fn().then(
      (data) => alive && setState({ data, loading: false }),
      (error) => alive && setState({ loading: false, error }),
    );
    return () => {
      alive = false;
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}

export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
