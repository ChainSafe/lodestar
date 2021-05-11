/**
 * Split an inclusive range into a sequence of contiguous inclusive ranges
 * ```
 * [[a,b], [c,d] ... Sn] = chunkifyInclusiveRange([a,z], n)
 * // where
 * [a,z] = [a,b] U [c,d] U ... U Sn
 * ```
 * @param from range start inclusive
 * @param to range end inclusive
 * @param chunks Maximum number of chunks, if range is big enough
 */
export function chunkifyInclusiveRange(from: number, to: number, itemsPerChunk: number): number[][] {
  if (itemsPerChunk < 1) itemsPerChunk = 1;
  const totalItems = to - from + 1;
  // Enforce chunkCount >= 1
  const chunkCount = Math.max(Math.ceil(totalItems / itemsPerChunk), 1);

  const chunks: number[][] = [];
  for (let i = 0; i < chunkCount; i++) {
    const _from = from + i * itemsPerChunk;
    const _to = Math.min(from + (i + 1) * itemsPerChunk - 1, to);
    chunks.push([_from, _to]);
    if (_to >= to) break;
  }
  return chunks;
}
