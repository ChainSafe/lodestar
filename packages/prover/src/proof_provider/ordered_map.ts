export class OrderedMap<K, V> extends Map<K, V> {
  get first(): V | undefined {
    const keys = [...this.keys()];
    return this.get(keys[0]);
  }

  get last(): V | undefined {
    const keys = [...this.keys()];
    return this.get(keys[keys.length - 1]);
  }
}
