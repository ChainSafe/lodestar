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
