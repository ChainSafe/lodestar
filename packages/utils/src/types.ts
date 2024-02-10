/**
 * Recursively make all properties optional
 * From https://stackoverflow.com/questions/45372227/how-to-implement-typescript-deep-partial-mapped-type-not-breaking-array-properti/49936686#49936686
 */
export type RecursivePartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? RecursivePartial<U>[]
    : T[P] extends Readonly<infer U>[]
    ? Readonly<RecursivePartial<U>>[]
    : RecursivePartial<T[P]>;
};

/** Type safe wrapper for Number constructor that takes 'any' */
export function bnToNum(bn: bigint): number {
  return Number(bn);
}

export type NonEmptyArray<T> = [T, ...T[]];

export type ArrayToTuple<Tuple extends NonEmptyArray<unknown>> = {
  [Index in keyof Tuple]: Tuple[Index];
};
