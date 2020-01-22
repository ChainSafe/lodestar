export interface IBaseSSZStaticTestCase<T> {
  roots: {
    root: string;
  };
  serialized: T;
  value: T;
}
