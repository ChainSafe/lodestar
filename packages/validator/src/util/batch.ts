/**
 * Convert array of items into array of batched item arrays
 */
export function batchItems<T>(items: T[], opts: {batchSize: number; maxBatches?: number}): T[][] {
  const batches: T[][] = [];
  const maxBatches = opts.maxBatches ?? Math.ceil(items.length / opts.batchSize);

  for (let i = 0; i < maxBatches; i++) {
    const batch = items.slice(opts.batchSize * i, opts.batchSize * (i + 1));
    if (batch.length === 0) break;
    batches.push(batch);
  }

  return batches;
}
