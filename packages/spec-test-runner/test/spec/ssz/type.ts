export interface IBaseSSZStaticTestCase<T> {
  roots: {
    root: string;
  };
  serialized: T;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  serialized_raw: Uint8Array;
  value: T;
}
