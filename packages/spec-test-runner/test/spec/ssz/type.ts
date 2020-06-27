export interface IBaseSSZStaticTestCase<T> {
  roots: {
    root: string;
  };
  serialized: T;
  serialized_raw: Uint8Array;
  value: T;
}
