/* eslint-disable @typescript-eslint/no-explicit-any */
import {expect} from "chai";
import {readdirSync, readFileSync, writeFile} from "fs";
import {describe, it} from "mocha";
import {basename, join, parse} from "path";
import profiler from "v8-profiler-next";
import {Type} from "@chainsafe/ssz";

import {isDirectory, loadYamlFile} from "./util";

export enum InputType {
  SSZ = "ssz",
  YAML = "yaml",
}

export interface ISpecTestOptions<TestCase, Result> {
  /**
   * If directory contains both ssz or yaml file version,
   * you can choose which one to use. Default is ssz.
   */
  inputTypes?: {[K in keyof NonNullable<TestCase>]?: InputType};

  sszTypes?: {[K in keyof NonNullable<TestCase>]?: Type<any>};

  /**
   * Optionally
   * @param testCase
   */
  getExpected?: (testCase: TestCase) => Result | undefined;

  /**
   * Optionally pass function to transform loaded values
   * (values from input files)
   */
  inputProcessing?: {[K: string]: (value: any) => any};

  shouldError?: (testCase: TestCase) => boolean;

  shouldSkip?: (testCase: TestCase, name: string, index: number) => boolean;

  expectFunc?: (testCase: TestCase, expected, actual) => void;

  timeout?: number;
}

export interface ITestCaseMeta {
  directoryName: string;
}

export function describeDirectorySpecTest<TestCase, Result>(
  name: string,
  testCaseParentDirpath: string,
  testFunction: (testCase: TestCase, directoryName: string) => Result,
  options: Partial<ISpecTestOptions<TestCase, Result>>
): void {
  if (!isDirectory(testCaseParentDirpath)) {
    throw new Error(`${testCaseParentDirpath} is not directory`);
  }
  describe(name, function () {
    readSubdirs(testCaseParentDirpath).forEach((testCaseDirpath, index) => {
      generateTestCase(testCaseDirpath, index, testFunction, options);
    });
  });
}

export function readSubdirs(dirpath: string): string[] {
  return readdirSync(dirpath)
    .map((name) => join(dirpath, name))
    .filter(isDirectory);
}

export function generateTestCase<TestCase, Result>(
  testCaseDirpath: string,
  index: number,
  testFunction: (...args: any) => Result,
  options: ISpecTestOptions<TestCase, Result>
): void {
  const {getExpected, expectFunc, shouldError, shouldSkip} = options;
  const name = basename(testCaseDirpath);

  it(name, function () {
    if (options.timeout) {
      this.timeout(options.timeout);
    }

    const testCase = loadInputFiles(testCaseDirpath, options);
    if (shouldSkip && shouldSkip(testCase, name, index)) {
      return this.skip();
    }
    if (shouldError && shouldError(testCase)) {
      try {
        testFunction(testCase, name);
      } catch (e) {
        return;
      }
    } else {
      const profileId = `${name}-${Date.now()}.profile`;
      const profilingDirectory = process.env.GEN_PROFILE_DIR;
      if (profilingDirectory) {
        profiler.startProfiling(profileId);
      }

      const result = testFunction(testCase, name);

      if (profilingDirectory) {
        const profile = profiler.stopProfiling(profileId);
        generateProfileReport(profile, profilingDirectory, profileId);
      }

      const expected = getExpected ? getExpected(testCase) : testCase;
      if (expectFunc) {
        expectFunc(testCase, expected, result);
      } else {
        expect(result).to.be.deep.equal(expected);
      }
    }
  });
}

function loadInputFiles<TestCase, Result>(directory: string, options: ISpecTestOptions<TestCase, Result>): TestCase {
  const testCase = {};
  readdirSync(directory)
    .map((name) => join(directory, name))
    .filter((file) => {
      if (isDirectory(file)) {
        return false;
      }
      const extension = options.inputTypes?.[parse(file).name] || InputType.SSZ;
      return file.endsWith(extension);
    })
    .forEach((file) => {
      const inputName = basename(file).replace(".ssz", "").replace(".yaml", "");
      testCase[inputName] = deserializeTestCase(file, inputName, options);
      if (file.endsWith(InputType.SSZ)) {
        testCase[`${inputName}_raw`] = readFileSync(file);
      }
      const inputProcessingFn = options.inputProcessing?.[inputName];
      if (inputProcessingFn) {
        testCase[inputName] = inputProcessingFn(testCase[inputName]);
      }
    });
  return testCase as TestCase;
}

function deserializeTestCase<TestCase, Result>(file, inputName, options: ISpecTestOptions<TestCase, Result>): object {
  if (file.endsWith(InputType.SSZ)) {
    const sszType = options.sszTypes?.[inputName];
    if (!sszType) {
      throw Error(`No sszType for ${inputName}`);
    }
    return sszType.deserialize(readFileSync(file));
  } else {
    return loadYamlFile(file);
  }
}

function generateProfileReport(profile, directory, profileId: string): void {
  profile.export((error, result) => {
    if (error) {
      return;
    }
    writeFile(`${directory}/${profileId}`, result, () => {
      profile.delete();
    });
  });
}
