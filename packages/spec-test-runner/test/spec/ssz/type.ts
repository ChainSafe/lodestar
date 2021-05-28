import {IBaseSpecTest} from "../type";

export interface IBaseSSZStaticTestCase<T> extends IBaseSpecTest {
  roots: {
    root: string;
  };
  serialized: T;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  serialized_raw: Uint8Array;
  value: T;
}
