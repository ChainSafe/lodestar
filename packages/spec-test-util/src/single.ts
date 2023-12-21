import fs from "node:fs";
import path from "node:path";
import {describe, it, vi, expect} from "vitest";
import {uncompress} from "snappyjs";
import {loadYaml} from "@lodestar/utils";

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

type SszTypeGeneric = {
  typeName: string;
  deserialize: (bytes: Uint8Array) => unknown;
  deserializeToViewDU?: (bytes: Uint8Array) => unknown;
};

export function toExpandedInputType(inputType: InputType | ExpandedInputType): ExpandedInputType {
  if ((inputType as ExpandedInputType).type !== undefined) {
    return inputType as ExpandedInputType;
  }
  return {
    type: inputType as InputType,
    treeBacked: false,
  };
}

export interface SpecTestOptions<TestCase extends {meta?: any}, Result> {
  /**
   * If directory contains both ssz or yaml file version,
   * you can choose which one to use. Default is ssz snappy.
   */
  inputTypes?: {[K in keyof NonNullable<TestCase>]?: InputType | ExpandedInputType};

  sszTypes?: Record<string, SszTypeGeneric>;

  /**
   * Some tests need to access the test case in order to generate ssz types for each input file.
   */
  getSszTypes?: (meta: TestCase["meta"]) => Record<string, SszTypeGeneric>;

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

const defaultOptions: SpecTestOptions<any, any> = {
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
  testFunction: (testCase: TestCase, directoryName: string) => Result | Promise<Result>,
  options: Partial<SpecTestOptions<TestCase, Result>>
): void {
  options = {...defaultOptions, ...options};
  if (!isDirectory(testCaseDirectoryPath)) {
    throw new Error(`${testCaseDirectoryPath} is not directory`);
  }

  describe(name, function () {
    if (options.timeout !== undefined) {
      vi.setConfig({testTimeout: options.timeout ?? 10 * 60 * 1000});
    }

    for (const testSubDirname of fs.readdirSync(testCaseDirectoryPath)) {
      const testSubDirPath = path.join(testCaseDirectoryPath, testSubDirname);
      if (!isDirectory(testSubDirPath)) {
        continue;
      }

      // Use full path here, not just `testSubDirname` to allow usage of `vitest --grep`
      const testName = `${name}/${testSubDirname}`;
      it(testName, async function (context) {
        // some tests require to load meta.yaml first in order to know respective ssz types.
        const metaFilePath = path.join(testSubDirPath, "meta.yaml");
        const meta: TestCase["meta"] = fs.existsSync(metaFilePath)
          ? loadYaml(fs.readFileSync(metaFilePath, "utf8"))
          : undefined;

        let testCase = loadInputFiles(testSubDirPath, options, meta);
        if (options.mapToTestCase) testCase = options.mapToTestCase(testCase);
        if (options.shouldSkip && options.shouldSkip(testCase, testName, 0)) {
          context.skip();
          return;
        }

        if (options.shouldError?.(testCase)) {
          try {
            await testFunction(testCase, name);
          } catch (e) {
            return;
          }
        } else {
          const result = await testFunction(testCase, name);
          if (!options.getExpected) throw Error("getExpected is not defined");
          if (!options.expectFunc) throw Error("expectFunc is not defined");
          const expected = options.getExpected(testCase);
          options.expectFunc(testCase, expected, result);
        }
      });
    }
  });
}

export function loadYamlFile(path: string): Record<string, unknown> {
  return loadYaml(fs.readFileSync(path, "utf8"));
}

function loadInputFiles<TestCase extends {meta?: any}, Result>(
  directory: string,
  options: SpecTestOptions<TestCase, Result>,
  meta?: TestCase["meta"]
): TestCase {
  const testCase: any = {};
  fs.readdirSync(directory)
    .map((name) => path.join(directory, name))
    .filter((file) => {
      if (isDirectory(file)) {
        return false;
      }
      if (!options.inputTypes) throw Error("inputTypes is not defined");
      const name = path.parse(file).name as keyof NonNullable<TestCase>;
      const inputType = toExpandedInputType(options.inputTypes[name] ?? InputType.SSZ_SNAPPY);
      // set options.inputTypes[name] with expanded input type
      options.inputTypes[name] = inputType;
      const extension = inputType.type as string;
      return file.endsWith(extension);
    })
    .forEach((file) => {
      const inputName = path.basename(file).replace(".ssz_snappy", "").replace(".ssz", "").replace(".yaml", "");
      const inputType = getInputType(file);
      testCase[inputName] = deserializeInputFile(file, inputName, inputType, options, meta);
      switch (inputType) {
        case InputType.SSZ:
          testCase[`${inputName}_raw`] = fs.readFileSync(file);
          break;
        case InputType.SSZ_SNAPPY:
          testCase[`${inputName}_raw`] = uncompress(fs.readFileSync(file));
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
  options: SpecTestOptions<TestCase, Result>,
  meta?: TestCase["meta"]
): any {
  if (inputType === InputType.YAML) {
    return loadYaml(fs.readFileSync(file, "utf8"));
  } else if (inputType === InputType.SSZ || inputType === InputType.SSZ_SNAPPY) {
    const sszTypes = options.getSszTypes ? options.getSszTypes(meta) : options.sszTypes;
    if (!sszTypes) throw Error("sszTypes is not defined");
    let data = fs.readFileSync(file);
    if (inputType === InputType.SSZ_SNAPPY) {
      data = uncompress(data);
    }

    let sszType: SszTypeGeneric | undefined;
    for (const key of Object.keys(sszTypes)) {
      // most tests configure with exact match
      // fork_choice tests configure with regex
      if ((key.startsWith("^") && inputName.match(key)) || inputName === key) {
        sszType = sszTypes[key];
        break;
      }
    }

    if (!sszType) {
      throw Error("Cannot find ssz type for inputName " + inputName);
    }

    // TODO: Refactor this to be typesafe
    if (sszType.typeName === "BeaconState") {
      if (!sszType.deserializeToViewDU) {
        throw Error("BeaconState type has no deserializeToViewDU method");
      }
      return sszType.deserializeToViewDU(data);
    } else {
      return sszType.deserialize(data);
    }
  }
}

function isDirectory(path: string): boolean {
  return fs.lstatSync(path).isDirectory();
}
