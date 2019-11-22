export class RoundRobinArray<T> {

  private readonly array: T[];

  private index: number = 0;

  public constructor(array: T[]) {
    this.array = this.shuffle(array);
  }

  public next(): T {
    return this.array[this.index++];
  }

  private shuffle(array: T[]): T[] {
    //TODO: implement some shuffling algorith
    return array;
  }
}