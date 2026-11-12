import fs from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {
  ArrayType,
  BitArray,
  BitArrayType,
  ByteArrayType,
  CompatibleUnionType,
  ContainerType,
  ProgressiveContainerType,
  Type,
  fromHexString,
} from "@chainsafe/ssz";
import {sszSpecTests} from "../specTestVersioning.js";
import {runValidSszTest} from "../utils/runValidSszTest.js";
import {getSszSpecTestType} from "./ssz_types.js";

type SszFixture = {
  typeName: string;
  serialized: string;
  root: string;
  value: unknown;
  rawBytes?: string;
  rejectionReason?: string;
};

const fixturesDir = path.join(sszSpecTests.outputDir, "fixtures", "ssz", "ssz");

for (const testSuite of fs.readdirSync(fixturesDir)) {
  const testSuiteDir = path.join(fixturesDir, testSuite);
  if (!fs.statSync(testSuiteDir).isDirectory()) {
    continue;
  }

  describe(`ssz/${testSuite}`, () => {
    for (const filename of fs.readdirSync(testSuiteDir)) {
      if (!filename.endsWith(".json")) {
        continue;
      }

      const testCases = parseFixtures(fs.readFileSync(path.join(testSuiteDir, filename), "utf8"));

      for (const [testId, testCase] of Object.entries(testCases)) {
        it(testId, () => {
          const type = getSszSpecTestType(testSuite, testCase.typeName);
          const serialized = fromHexString(testCase.rawBytes ?? testCase.serialized);

          if (testCase.rejectionReason !== undefined) {
            expect(
              () => type.deserialize(serialized),
              `${testId}: expected ${testCase.typeName} deserialization to reject`
            ).toThrow();
            return;
          }

          const value = type.deserialize(serialized);
          const expectedValue = fromFixtureValue(type, testCase.value);
          expect(
            type.equals(value, expectedValue),
            `${testId}: deserialized ${testCase.typeName} value does not match the fixture`
          ).toBe(true);
          runValidSszTest(type, {
            root: testCase.root,
            serialized,
            jsonValue: type.toJson(expectedValue),
          });
        });
      }
    }
  });
}

function parseFixtures(json: string): Record<string, SszFixture> {
  // SSZ-spec fixtures encode uint64+ values as JSON numbers. Preserve unsafe integers as
  // decimal strings so UintBigintType can consume them without losing precision.
  const parseWithSource = JSON.parse as unknown as (
    text: string,
    reviver: (key: string, value: unknown, context: {source: string}) => unknown
  ) => unknown;
  return parseWithSource(json, (_key, value, context) => {
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      return context.source;
    }
    return value;
  }) as Record<string, SszFixture>;
}

function fromFixtureValue(type: Type<unknown>, json: unknown): unknown {
  if (type instanceof BitArrayType) {
    return BitArray.fromBoolArray(unwrapData(json) as boolean[]);
  }

  if (type instanceof ByteArrayType) {
    return type.fromJson(unwrapData(json));
  }

  if (type instanceof ArrayType) {
    const data = unwrapData(json);
    if (!Array.isArray(data)) {
      throw Error(`Expected array fixture value for ${type.typeName}`);
    }
    return data.map((item) => fromFixtureValue(type.elementType, item));
  }

  if (type instanceof CompatibleUnionType) {
    const union = json as {selector: number | string; data: unknown};
    const selector = Number(union.selector);
    return {selector, data: fromFixtureValue(type.getType(selector), union.data)};
  }

  if (type instanceof ContainerType || type instanceof ProgressiveContainerType) {
    const object = json as Record<string, unknown>;
    const value: Record<string, unknown> = {};
    for (const [fieldName, fieldType] of Object.entries(type.fields as Record<string, Type<unknown>>)) {
      value[fieldName] = fromFixtureValue(fieldType, object[fieldName]);
    }
    return value;
  }

  return type.fromJson(json);
}

function unwrapData(json: unknown): unknown {
  if (typeof json === "object" && json !== null && "data" in json) {
    return (json as {data: unknown}).data;
  }
  return json;
}
