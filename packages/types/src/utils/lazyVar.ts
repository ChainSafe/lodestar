export class LazyVariable<T> {
  private var: {set: false} | {set: true; value: T} = {set: false};

  get(): T {
    if (!this.var.set) throw Error("variable not set");
    return this.var.value;
  }

  set(value: T): void {
    this.var = {set: true, value};
  }
}
