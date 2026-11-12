/**
 * Recursively make all properties optional
 */
type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type Builtin = Primitive | Date | Error | RegExp;

export type RecursivePartial<T> =
  // stop on built-ins (incl. Error) and functions
  T extends Builtin
    ? T
    : // arrays and readonly arrays
      T extends ReadonlyArray<infer U>
      ? ReadonlyArray<RecursivePartial<U>>
      : T extends Array<infer U>
        ? Array<RecursivePartial<U>>
        : // (optionally: Map/Set support)
          T extends Map<infer K, infer V>
          ? Map<RecursivePartial<K>, RecursivePartial<V>>
          : T extends Set<infer U>
            ? Set<RecursivePartial<U>>
            : // plain objects
              T extends object
              ? {[P in keyof T]?: RecursivePartial<T[P]>}
              : // fallback (shouldn’t be hit often)
                T;

/** Type safe wrapper for Number constructor that takes 'any' */
export function bnToNum(bn: bigint): number {
  return Number(bn);
}

export type NonEmptyArray<T> = [T, ...T[]];

/**
 * ArrayToTuple converts an `Array<T>` to `[T, ...T]`
 *
 * eg: `[1, 2, 3]` from type `number[]` to `[number, number, number]`
 */
export type ArrayToTuple<Tuple extends NonEmptyArray<unknown>> = {
  [Index in keyof Tuple]: Tuple[Index];
};

/**
 * Convert optional attributes of an object to required
 */
export type RequiredSelective<T, Keys extends keyof T> = T & {
  [K in Keys]-?: T[K];
};
