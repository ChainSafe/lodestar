export type Mutable<T, K extends keyof T> = Omit<T, K> & {-readonly [key in K]: T[key]};
