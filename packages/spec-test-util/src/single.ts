import {expect} from "chai";
import fs, {readdirSync, readFileSync, existsSync} from "node:fs";
import {basename, join, parse} from "node:path";
import {Type, CompositeType} from "@chainsafe/ssz";
import {uncompress} from "snappyjs";
import {loadYaml} from "@chainsafe/lodestar-utils";

/* eslint-disable
  @typescript-eslint/no-unsafe-assignment,
  @typescript-eslint/no-unsafe-member-access,
  @typescript-eslint/no-unsafe-return,
  @typescript-eslint/no-explicit-any,
  func-names */

export enum InputType {
  SSZ = "ssz",
  SSZ_SNAPPY = "ssz_snappy",
  YAML = "yaml",
}

export type ExpandedInputType = {
  type: InputType;
  treeBacked: boolean;
};

export function toExpandedInputType(inputType: InputType | ExpandedInputType): ExpandedInputType {
  if ((inputType as ExpandedInputType).type) {
    return inputType as ExpandedInputType;
  }
  return {
    type: inputType as InputType,
    treeBacked: false,
  };
}

function isDirectory(path: string): boolean {
  return fs.lstatSync(path).isDirectory();
}

export interface ISpecTestOptions<TestCase extends {meta?: any}, Result> {
  /**
   * If directory contains both ssz or yaml file version,
   * you can choose which one to use. Default is ssz snappy.
   */
  inputTypes?: {[K in keyof NonNullable<TestCase>]?: InputType | ExpandedInputType};

  sszTypes?: Record<string, Type<any>>;

  /**
   * Some tests need to access the test case in order to generate ssz types for each input file.
   */
  getSszTypes?: (meta: TestCase["meta"]) => Record<string, Type<any>>;

  /**
   * loadInputFiles sometimes not create TestCase due to abnormal input file names.
   * Use this to map to real test case.
   */
  mapToTestCase?: (t: Record<string, any>) => TestCase;

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

  expectFunc?: (testCase: TestCase, expected: any, actual: any) => void;

  timeout?: number;
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
  timeout: 10 * 60 * 1000,
};

export function describeDirectorySpecTest<TestCase extends {meta?: any}, Result>(
  name: string,
  testCaseDirectoryPath: string,
  testFunction: (testCase: TestCase, directoryName: string) => Result,
  options: Partial<ISpecTestOptions<TestCase, Result>>
): void {
  options = {...defaultOptions, ...options};
  if (!isDirectory(testCaseDirectoryPath)) {
    throw new Error(`${testCaseDirectoryPath} is not directory`);
  }
  describe(name, function () {
    if (options.timeout !== undefined) {
      this.timeout(options.timeout || "10 min");
    }

    const testCases = readdirSync(testCaseDirectoryPath)
      .map((name) => join(testCaseDirectoryPath, name))
      .filter(isDirectory);

    for (const [index, testCaseDirectory] of testCases.entries()) {
      generateTestCase(testCaseDirectory, index, testFunction, options);
    }
  });
}

function generateTestCase<TestCase extends {meta?: any}, Result>(
  testCaseDirectoryPath: string,
  index: number,
  testFunction: (...args: any) => Result,
  options: ISpecTestOptions<TestCase, Result>
): void {
  const name = basename(testCaseDirectoryPath);
  it(name, function () {
    // some tests require to load meta.yaml first in order to know respective ssz types.
    const metaFilePath = join(testCaseDirectoryPath, "meta.yaml");
    let meta: TestCase["meta"] = undefined;
    if (existsSync(metaFilePath)) {
      meta = loadYaml(fs.readFileSync(metaFilePath, "utf8"));
    }
    let testCase = loadInputFiles(testCaseDirectoryPath, options, meta);
    if (options.mapToTestCase) testCase = options.mapToTestCase(testCase);
    if (options.shouldSkip && options.shouldSkip(testCase, name, index)) {
      this.skip();
      return;
    }
    if (options.shouldError && options.shouldError(testCase)) {
      try {
        testFunction(testCase, name);
      } catch (e) {
        return;
      }
    } else {
      const result = testFunction(testCase, name);
      if (!options.getExpected) throw Error("getExpected is not defined");
      if (!options.expectFunc) throw Error("expectFunc is not defined");
      const expected = options.getExpected(testCase);
      options.expectFunc(testCase, expected, result);
    }
  });
}

function loadInputFiles<TestCase extends {meta?: any}, Result>(
  directory: string,
  options: ISpecTestOptions<TestCase, Result>,
  meta?: TestCase["meta"]
): TestCase {
  const testCase: any = {};
  readdirSync(directory)
    .map((name) => join(directory, name))
    .filter((file) => {
      if (isDirectory(file)) {
        return false;
      }
      if (!options.inputTypes) throw Error("inputTypes is not defined");
      const name = parse(file).name as keyof NonNullable<TestCase>;
      const inputType = toExpandedInputType(options.inputTypes[name] ?? InputType.SSZ_SNAPPY);
      // set options.inputTypes[name] with expanded input type
      options.inputTypes[name] = inputType;
      const extension = inputType.type as string;
      return file.endsWith(extension);
    })
    .forEach((file) => {
      const inputName = basename(file).replace(".ssz_snappy", "").replace(".ssz", "").replace(".yaml", "");
      const inputType = getInputType(file);
      testCase[inputName] = deserializeInputFile(file, inputName, inputType, options, meta);
      switch (inputType) {
        case InputType.SSZ:
          testCase[`${inputName}_raw`] = readFileSync(file);
          break;
        case InputType.SSZ_SNAPPY:
          testCase[`${inputName}_raw`] = uncompress(readFileSync(file));
          break;
      }
      if (!options.inputProcessing) throw Error("inputProcessing is not defined");
      if (options.inputProcessing[inputName] !== undefined) {
        testCase[inputName] = options.inputProcessing[inputName](testCase[inputName]);
      }
    });
  return testCase as TestCase;
}

function getInputType(filename: string): InputType {
  if (filename.endsWith(InputType.YAML)) {
    return InputType.YAML;
  } else if (filename.endsWith(InputType.SSZ_SNAPPY)) {
    return InputType.SSZ_SNAPPY;
  } else if (filename.endsWith(InputType.SSZ)) {
    return InputType.SSZ;
  }
  throw new Error(`Could not get InputType from ${filename}`);
}

function deserializeInputFile<TestCase extends {meta?: any}, Result>(
  file: string,
  inputName: string,
  inputType: InputType,
  options: ISpecTestOptions<TestCase, Result>,
  meta?: TestCase["meta"]
): any {
  if (inputType === InputType.YAML) {
    return loadYaml(fs.readFileSync(file, "utf8"));
  } else if (inputType === InputType.SSZ || inputType === InputType.SSZ_SNAPPY) {
    const sszTypes = options.getSszTypes ? options.getSszTypes(meta) : options.sszTypes;
    if (!sszTypes) throw Error("sszTypes is not defined");
    let data = readFileSync(file);
    if (inputType === InputType.SSZ_SNAPPY) {
      data = uncompress(data);
    }
    let sszType: Type<any> | undefined;
    for (const key of Object.keys(sszTypes)) {
      // most tests configure with exact match
      // fork_choice tests configure with regex
      if ((key.startsWith("^") && inputName.match(key)) || inputName === key) {
        sszType = sszTypes[key];
        break;
      }
    }
    if (sszType) {
      if ((options.inputTypes?.[inputName as keyof TestCase] as ExpandedInputType).treeBacked) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        return (sszType as CompositeType<any>).createTreeBackedFromBytes(data);
      } else {
        return sszType.deserialize(data);
      }
    } else {
      throw Error("Cannot find ssz type for inputName " + inputName);
    }
  }
}
