import {ForkName} from "@lodestar/params";
import {SpecTestOptions} from "@lodestar/spec-test-util";

export enum RunnerType {
  custom,
  default,
}

export type TestRunnerFn<TestCase extends {meta?: any}, Result> = (
  fork: ForkName,
  testHandler: string,
  testSuite: string
) => {
  testFunction: (testCase: TestCase, directoryName: string) => Result | Promise<Result>;
  options: Partial<SpecTestOptions<TestCase, Result>>;
};

export type TestRunnerCustom = (
  fork: ForkName,
  testHandler: string,
  testSuite: string,
  testSuiteDirpath: string
) => void;

export type TestRunner =
  | {type: RunnerType.default; fn: TestRunnerFn<any, any>}
  | {type: RunnerType.custom; fn: TestRunnerCustom};

/* eslint-disable @typescript-eslint/naming-convention */

export type BaseSpecTest = {
  meta?: {
    bls_setting?: bigint;
  };
};

export function shouldVerify(testCase: BaseSpecTest): boolean {
  return testCase.meta?.bls_setting === BigInt(1);
}
