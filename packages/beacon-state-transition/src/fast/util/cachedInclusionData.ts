import {List} from "@chainsafe/ssz";
import {MutableVector, Vector} from "@chainsafe/persistent-ts";

export interface IInclusionData {
  inclusionDelay: number;
  proposerIndex: number;
}

/**
 * Used in phase0 to cache pending attestation results
 */
export class CachedInclusionDataList implements List<IInclusionData> {
  [index: number]: IInclusionData;
  persistent: MutableVector<IInclusionData>;

  constructor(persistent: MutableVector<IInclusionData>) {
    this.persistent = persistent;
  }

  get length(): number {
    return this.persistent.length;
  }

  getAllInclusionData(): Vector<IInclusionData> {
    return this.persistent.vector;
  }

  get(index: number): IInclusionData | undefined {
    return this.persistent.get(index) ?? undefined;
  }

  set(index: number, data: IInclusionData): void {
    this.persistent.set(index, data);
  }

  updateAll(data: Vector<IInclusionData>): void {
    this.persistent.vector = data;
  }

  push(data: IInclusionData): number {
    this.persistent.push(data);
    return this.persistent.length;
  }

  pop(): IInclusionData {
    return this.persistent.pop() as IInclusionData;
  }

  *[Symbol.iterator](): Iterator<IInclusionData> {
    yield* this.persistent[Symbol.iterator]();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  find(fn: (value: IInclusionData, index: number, list: this) => boolean): IInclusionData | undefined {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  findIndex(fn: (value: IInclusionData, index: number, list: this) => boolean): number {
    return -1;
  }

  forEach(fn: (value: IInclusionData, index: number, list: this) => void): void {
    this.persistent.forEach(fn as (value: IInclusionData, index: number) => void);
  }

  map<T>(fn: (value: IInclusionData, index: number) => T): T[] {
    return this.persistent.map(fn);
  }
}
