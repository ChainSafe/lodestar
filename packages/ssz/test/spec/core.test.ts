import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {types} from "@chainsafe/eth2.0-ssz-types/lib/presets/mainnet";

import {deserialize, serialize, hashTreeRoot, signingRoot, equals, hash} from "../../src";

import {hydrateType, hydrateValue, getTestType, getTestValue} from "./util";

// Serialize

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_static/core/ssz_mainnet_random.yaml"),
  serialize,
  (testCase) => {
    const typeName = getTestType(testCase);
    const value = getTestValue(testCase, 'value');
    const type = hydrateType((types as any)[typeName]);
    const v = hydrateValue(value, type);
    return [v, type];
  },
  (testCase) => {
    const serialized = getTestValue(testCase, 'serialized');
    return serialized.slice(2);
  },
  (result) => result.toString('hex'),
);

// Deserialize

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_static/core/ssz_mainnet_random.yaml"),
  deserialize,
  (testCase) => {
    const typeName = getTestType(testCase);
    const serialized = getTestValue(testCase, 'serialized');
    const type = hydrateType((types as any)[typeName]);
    return [Buffer.from(serialized.slice(2), 'hex'), type];
  },
  (testCase) => {
    const typeName = getTestType(testCase);
    const value = getTestValue(testCase, 'value');
    const type = hydrateType((types as any)[typeName]);
    const v = hydrateValue(value, type);
    return v;
  },
  (result) => result,
  () => false,
  () => false,
  (testCase, expect, expected, actual) => {
    const typeName = getTestType(testCase);
    const type = hydrateType((types as any)[typeName]);
    expect(equals(expected, actual, type)).to.equal(true);
  },
);

// hashTreeRoot

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_static/core/ssz_mainnet_random.yaml"),
  hashTreeRoot,
  (testCase) => {
    const typeName = getTestType(testCase);
    const value = getTestValue(testCase, 'value');
    const type = hydrateType((types as any)[typeName]);
    const v = hydrateValue(value, type);
    return [v, type];
  },
  (testCase) => {
    const root = getTestValue(testCase, 'root');
    return root.slice(2);
  },
  (result) => result.toString('hex'),
);

// signingRoot

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_static/core/ssz_mainnet_random.yaml"),
  signingRoot,
  (testCase) => {
    const typeName = getTestType(testCase);
    const value = getTestValue(testCase, 'value');
    const type = hydrateType((types as any)[typeName]);
    const v = hydrateValue(value, type);
    return [v, type];
  },
  (testCase) => {
    const signingRoot = getTestValue(testCase, 'signingRoot');
    return signingRoot.slice(2);
  },
  (result) => result.toString('hex'),
  () => false,
  (testCase) => !getTestValue(testCase, 'signingRoot')
);
