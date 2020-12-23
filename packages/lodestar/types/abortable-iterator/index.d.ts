declare module "abortable-iterator" {
  type Source<T> = AsyncIterable<T>;
  type Sink<TSource, TReturn = void> = (source: Source<TSource>) => TReturn;
  type Duplex<TSource = unknown, TReturn = unknown> = {
    sink: Sink<TSource, TReturn>;
    source: Source<TSource>;
  };

  type Options<T> = {
    onAbort?: (source: Source<T>) => void;
    abortMessage?: string;
    abortCode?: string;
    returnOnAbort?: boolean;
  };

  function source<T>(source: T[], signal?: AbortSignal, options?: Options<T>): AsyncIterable<T>;
  function source<T>(source: Source<T>, signal?: AbortSignal, options?: Options<T>): AsyncIterable<T>;

  function duplex<TSource = unknown, TReturn = unknown>(
    duplex: Duplex<TSource, TReturn>,
    signal?: AbortSignal,
    options?: Options<TSource>
  ): Duplex<TSource, TReturn>;

  export {source, duplex};
  export default source;
}
