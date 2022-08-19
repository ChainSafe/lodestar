export class MapDef<K, V> extends Map<K, V> {
  constructor(private readonly getDefault: () => V) {
    super();
  }

  getOrDefault(key: K): V {
    let value = super.get(key);
    if (value === undefined) {
      value = this.getDefault();
      this.set(key, value);
    }
    return value;
  }
}

/**
 * Prune an arbitrary set removing the first keys to have a set.size === maxItems.
 * Returns the count of deleted items.
 */
export function pruneSetToMax<T>(set: Set<T> | Map<T, unknown>, maxItems: number): number {
  let itemsToDelete = set.size - maxItems;
  const deletedItems = Math.max(0, itemsToDelete);

  if (itemsToDelete > 0) {
    for (const key of set.keys()) {
      set.delete(key);
      itemsToDelete--;
      if (itemsToDelete <= 0) {
        break;
      }
    }
  }

  return deletedItems;
}
