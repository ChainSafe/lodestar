export class OrderedMap<T> extends Map<number, T> {
  private _min?: number;
  private _max?: number;

  get min(): number | undefined {
    return this._min;
  }

  get max(): number | undefined {
    return this._max;
  }

  set(key: number, value: T): this {
    if (this._min === undefined || key < this._min) {
      this._min = key;
    }

    if (this._max === undefined || key > this._max) {
      this._max = key;
    }

    super.set(key, value);
    return this;
  }
}
