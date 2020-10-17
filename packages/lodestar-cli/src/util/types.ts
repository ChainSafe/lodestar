export type RecursivePartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? RecursivePartial<U>[]
    : T[P] extends Readonly<infer U>[]
    ? Readonly<RecursivePartial<U>>[]
    : RecursivePartial<T[P]>;
};
