/* eslint-disable @typescript-eslint/naming-convention */

export interface IBaseSpecTest {
  meta?: {
    bls_setting?: BigInt;
  };
}

export function shouldVerify(testCase: IBaseSpecTest): boolean {
  return testCase.meta?.bls_setting === BigInt(1);
}
