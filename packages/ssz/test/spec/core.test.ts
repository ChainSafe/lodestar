import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {types} from "@chainsafe/eth2.0-ssz-types/lib/presets/mainnet";

import {deserialize, equals, hashTreeRoot, serialize, signingRoot} from "../../src";

import {getTestType, getTestValue, hydrateType, hydrateValue} from "./util";

// Serialize

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_static/core/ssz_mainnet_random.yaml"),
  serialize,
  (testCase: any) => {
    const typeName = getTestType(testCase);
    const value = getTestValue(testCase, "value");
    const type = hydrateType((types as any)[typeName]);
    const v = hydrateValue(value, type);
    return [v, type];
  },
  (testCase: any) => {
    const serialized = getTestValue(testCase, "serialized");
    return serialized.slice(2);
  },
  (result: any) => result.toString("hex"),
);

// Deserialize

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_static/core/ssz_mainnet_random.yaml"),
  deserialize,
  (testCase: any) => {
    const typeName = getTestType(testCase);
    const serialized = getTestValue(testCase, "serialized");
    const type = hydrateType((types as any)[typeName]);
    return [Buffer.from(serialized.slice(2), "hex"), type];
  },
  (testCase: any) => {
    const typeName = getTestType(testCase);
    const value = getTestValue(testCase, "value");
    const type = hydrateType((types as any)[typeName]);
    const v = hydrateValue(value, type);
    return v;
  },
  (result: any) => result,
  () => false,
  () => false,
  (testCase: any, expect: any, expected: any, actual: any) => {
    const typeName = getTestType(testCase);
    const type = hydrateType((types as any)[typeName]);
    expect(equals(expected, actual, type)).to.equal(true);
  },
);

// hashTreeRoot

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_static/core/ssz_mainnet_random.yaml"),
  hashTreeRoot,
  (testCase: any) => {
    const typeName = getTestType(testCase);
    const value = getTestValue(testCase, "value");
    const type = hydrateType((types as any)[typeName]);
    const v = hydrateValue(value, type);
    return [v, type];
  },
  (testCase: any) => {
    const root = getTestValue(testCase, "root");
    return root.slice(2);
  },
  (result: any) => result.toString("hex"),
);

// signingRoot

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_static/core/ssz_mainnet_random.yaml"),
  signingRoot,
  (testCase: any) => {
    const typeName = getTestType(testCase);
    const value = getTestValue(testCase, "value");
    const type = hydrateType((types as any)[typeName]);
    const v = hydrateValue(value, type);
    return [v, type];
  },
  (testCase: any) => {
    const signingRoot = getTestValue(testCase, "signingRoot");
    return signingRoot.slice(2);
  },
  (result: any) => result.toString("hex"),
  () => false,
  (testCase: any) => !getTestValue(testCase, "signingRoot")
);
