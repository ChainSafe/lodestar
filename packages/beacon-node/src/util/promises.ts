/**
 * Promise.all() but allows all functions to run even if one throws syncronously
 */
export function promiseAllMaybeAsync<T>(fns: Array<() => Promise<T>>): Promise<T[]> {
  return Promise.all(
    fns.map((fn) => {
      try {
        return fn();
      } catch (e) {
        return Promise.reject(e);
      }
    })
  );
}
