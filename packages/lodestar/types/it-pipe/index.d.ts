// Overwrite types until this issue is fixed https://github.com/alanshaw/it-pipe/issues/4
// Original types contain
// ```
// export function pipe (first: any, ...rest: any[]): any
// ```
// Which act as a @ts-ignore compromising type safety

declare module "it-pipe" {
  export function pipe<A, B>(first: A | (() => A), second: (source: A) => B): B;

  export function pipe<A, B, C>(first: A | (() => A), second: (source: A) => B, third: (source: B) => C): C;

  export function pipe<A, B, C, D>(
    first: A | (() => A),
    second: (source: A) => B,
    third: (source: B) => C,
    fourth: (source: C) => D
  ): D;

  export function pipe<A, B, C, D, E>(
    first: A | (() => A),
    second: (source: A) => B,
    third: (source: B) => C,
    fourth: (source: C) => D,
    fifth: (source: D) => E
  ): E;

  export function pipe<A, B, C, D, E, F>(
    first: A | (() => A),
    second: (source: A) => B,
    third: (source: B) => C,
    fourth: (source: C) => D,
    fifth: (source: D) => E,
    sixth: (source: E) => F
  ): F;

  export function pipe<A, B, C, D, E, F, G>(
    first: A | (() => A),
    second: (source: A) => B,
    third: (source: B) => C,
    forth: (source: C) => D,
    fifth: (source: D) => E,
    sixth: (source: E) => F,
    seventh: (source: F) => G
  ): G;

  export function pipe<A, B, C, D, E, F, G, H>(
    first: A | (() => A),
    second: (source: A) => B,
    third: (source: B) => C,
    forth: (source: C) => D,
    fifth: (source: D) => E,
    sixth: (source: E) => F,
    seventh: (source: F) => G,
    eighth: (source: G) => H
  ): H;

  export function pipe<A, B, C, D, E, F, G, H, I>(
    first: A | (() => A),
    second: (source: A) => B,
    third: (source: B) => C,
    forth: (source: C) => D,
    fifth: (source: D) => E,
    sixth: (source: E) => F,
    seventh: (source: F) => G,
    eighth: (source: G) => H,
    ninth: (source: H) => I
  ): I;

  export function pipe<A, B, C, D, E, F, G, H, I, J>(
    first: A | (() => A),
    second: (source: A) => B,
    third: (source: B) => C,
    forth: (source: C) => D,
    fifth: (source: D) => E,
    sixth: (source: E) => F,
    seventh: (source: F) => G,
    eighth: (source: G) => H,
    ninth: (source: H) => I,
    tenth: (source: I) => J
  ): I;

  export default pipe;
}
