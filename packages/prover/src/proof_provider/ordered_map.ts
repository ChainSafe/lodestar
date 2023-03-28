export class OrderedMap<T> extends Map<number, T> {
  private _min = 0;
  private _max = 0;

  get min(): number {
    return this._min;
  }

  get max(): number {
    return this._max;
  }

  set(key: number, value: T): this {
    if (key < this._min) {
      this._min = key;
    }

    if (key > this._max) {
      this._max = key;
    }

    super.set(key, value);
    return this;
  }
}
