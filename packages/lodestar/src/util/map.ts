/**
 * 2 dimensions Es6 Map
 */
export class Map2d<K1, K2, V> {
  readonly map = new Map<K1, Map<K2, V>>();

  get(k1: K1, k2: K2): V | undefined {
    return this.map.get(k1)?.get(k2);
  }

  set(k1: K1, k2: K2, v: V): void {
    let map2 = this.map.get(k1);
    if (!map2) {
      map2 = new Map<K2, V>();
      this.map.set(k1, map2);
    }
    map2.set(k2, v);
  }
}

/**
 * 2 dimensions Es6 Map + regular array
 */
export class Map2dArr<K1, V> {
  readonly map = new Map<K1, V[]>();

  get(k1: K1, idx: number): V | undefined {
    return this.map.get(k1)?.[idx];
  }

  set(k1: K1, idx: number, v: V): void {
    let arr = this.map.get(k1);
    if (!arr) {
      arr = [];
      this.map.set(k1, arr);
    }
    arr[idx] = v;
  }
}
