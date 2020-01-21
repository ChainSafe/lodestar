export interface IBaseSSZStaticTestCase<T> {
  roots: {
    root: string;
    signingRoot: string;
  };
  serialized: T;
  value: T;
}