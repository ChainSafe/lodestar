/**
 * Sort by multiple prioritized conditions
 * - Sort is stable
 * - Sort does not mutate the original array
 * @param condition Must return an number, used to sort compare each item
 * - conditions[0] has priority over conditions[1]
 */
export function sortBy<T>(arr: T[], ...conditions: ((item: T) => number)[]): T[] {
  return [...arr].sort((a, b) => {
    for (const condition of conditions) {
      const ca = condition(a);
      const cb = condition(b);
      if (ca > cb) return 1;
      if (ca < cb) return -1;
    }
    return 0;
  });
}
