export interface BaseSSZStaticTestCase<T> {
  roots: {
    root: string;
    signingRoot: string;
  };
  serialized: T;
  value: T;
}