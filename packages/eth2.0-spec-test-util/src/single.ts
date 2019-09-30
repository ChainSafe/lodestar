/* eslint-disable @typescript-eslint/no-explicit-any */
import {readdirSync, readFileSync, writeFile} from "fs";
import {isDirectory} from "./util";
import {basename, join, parse} from "path";
import {describe, it} from "mocha";
import {AnySSZType, deserialize} from "@chainsafe/ssz";
import {expect} from "chai";
import deepMerge from "deepmerge";
import profiler from "v8-profiler-next";
import {transformType} from "./transform";
import {loadYamlFile} from "@chainsafe/eth2.0-utils";


export enum InputType {
  SSZ= "ssz",
  YAML= "yaml"
}

export interface ISpecTestOptions<TestCase, Result> {
  /**
   * If directory contains both ssz or yaml file version,
   * you can choose which one to use. Default is ssz.
   */
  inputTypes?: {[K in keyof NonNullable<TestCase>]: InputType};

  sszTypes?: {[K in keyof NonNullable<TestCase>]: AnySSZType};

  /**
   * Optionally
   * @param testCase
   */
  getExpected?: (testCase: TestCase) => Result;

  /**
   * Optionally pass function to transform loaded values
   * (values from input files)
   */
  inputProcessing?: {[K: string]: (value: any, directoryName: string) => any};

  shouldError?: (testCase: TestCase) => boolean;

  shouldSkip?: (testCase: TestCase, directoryName: string) => boolean;

  expectFunc?: (testCase: TestCase, expected, actual, directoryName: string) => void;

  timeout?: number;

  /**
   * Whether input is unsafe (and ssz types should be transformed)
   */
  unsafeInput?: boolean;

}

export interface ITestCaseMeta {
  directoryName: string;
}

const defaultOptions: ISpecTestOptions<any, any> = {
  inputTypes: {},
  inputProcessing: {},
  sszTypes: {},
  getExpected: (testCase) => testCase,
  shouldError: () => false,
  shouldSkip: () => false,
  expectFunc: (testCase, expected, actual) => expect(actual).to.be.deep.equal(expected),
  timeout: 4000
};

export function describeDirectorySpecTest<TestCase, Result>(
  name: string,
  testCaseDirectoryPath: string,
  testFunction: (testCase: TestCase, directoryName: string) => Result,
  options: Partial<ISpecTestOptions<TestCase, Result>>
): void {
  // @ts-ignore
  options = deepMerge(defaultOptions, options);
  if(!isDirectory(testCaseDirectoryPath)) {
    throw new Error(`${testCaseDirectoryPath} is not directory`);
  }
  describe(name, function () {
    if(options.timeout) {
      this.timeout(options.timeout);
    }

    const testCases = readdirSync(testCaseDirectoryPath)
      .map(name => join(testCaseDirectoryPath, name))
      .filter(isDirectory);

    testCases.forEach((testCaseDirectory) => {
      generateTestCase(
        name,
        testCaseDirectory,
        testFunction,
        options
      );
    });

  });

}

function generateTestCase<TestCase, Result>(
  name: string,
  testCaseDirectoryPath: string,
  testFunction: (...args: any) => Result,
  options: ISpecTestOptions<TestCase, Result>
): any {
  it(basename(testCaseDirectoryPath), function () {
    const testCase = loadInputFiles(testCaseDirectoryPath, options);
    if(options.shouldSkip && options.shouldSkip(testCase, basename(testCaseDirectoryPath))) {
      return this.skip();
    }
    if(options.shouldError && options.shouldError(testCase)) {
      expect(testFunction.bind(null, testCase, basename(testCaseDirectoryPath))).to.throw;
    } else {
      const profileId = `${name}-${Date.now()}.profile`;
      const profilingDirectory = process.env.GEN_PROFILE_DIR;
      if (profilingDirectory) {
        profiler.startProfiling(profileId);
      }
      const result = testFunction(testCase, basename(testCaseDirectoryPath));
      if (profilingDirectory) {
        const profile = profiler.stopProfiling(profileId);

        generateProfileReport(profile, profilingDirectory, profileId);
      }
      const expected = options.getExpected(testCase);
      options.expectFunc(testCase, expected, result, basename(testCaseDirectoryPath));
    }
  });
}

function loadInputFiles<TestCase, Result>(
  directory: string, options: ISpecTestOptions<TestCase, Result>
): TestCase {
  const testCase = {};
  readdirSync(directory)
    .map(name => join(directory, name))
    .filter((file) => {
      if(isDirectory(file)) {
        return false;
      }
      const extension = options.inputTypes[parse(file).name] || InputType.SSZ;
      return file.endsWith(extension);
    })
    .forEach((file) => {
      const inputName = basename(file).replace(".ssz", "").replace(".yaml", "");
      try {
        testCase[inputName] = deserializeTestCase(file, inputName, options);
      } catch (e) {
        //failed to deserialize
        testCase[inputName] = null;
      }
      if (file.endsWith(InputType.SSZ)) {
        testCase[`${inputName}_raw`] = readFileSync(file);
      }
      if(options.inputProcessing[inputName]) {
        testCase[inputName] = options.inputProcessing[inputName](testCase[inputName], basename(directory));
      }
    });
  return testCase as TestCase;
}

function deserializeTestCase<TestCase, Result>(file, inputName, options: ISpecTestOptions<TestCase, Result>): object {
  if (file.endsWith(InputType.SSZ)) {
    const safeType = options.unsafeInput
      ? transformType(options.sszTypes[inputName])
      : options.sszTypes[inputName];
    return deserialize(readFileSync(file), safeType);
  } else {
    return  loadYamlFile(file);
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

