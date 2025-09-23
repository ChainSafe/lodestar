// Bun does not support `GCProfiler` from `node:v8`a
// Which is exposed from `@chainsafe/prometheus-gc-stats` and used in `packages/beacon-node/src/metrics/nodeJsMetrics.ts`
// So we expose a dummy function for Bun runtime which do nothing for now
// TODO: May look get some useful data from `bun:jsc`
export function gcStats() {
  return () => {};
}
