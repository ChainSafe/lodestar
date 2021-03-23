export function isSorted(indices: number[]): boolean {
  for (let i = 0, prevIndex = -1; i < indices.length; i++) {
    if (indices[i] <= prevIndex) {
      return false;
    }
    prevIndex = indices[i];
  }
  return true;
}
