export class RoundRobinArray<T> {
  private readonly array: T[];

  private index = 0;

  public constructor(array: T[]) {
    this.array = this.shuffle(array);
  }

  public next(): T | null {
    const item = this.array[this.index++];
    if (item) {
      return item;
    } else {
      this.index = 0;
      return this.array[this.index];
    }
  }

  private shuffle(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}
