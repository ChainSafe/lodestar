import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";

import {deserialize, serialize, hashTreeRoot, signingRoot} from "../../src";
import * as types from "../../../lodestar/src/types";

import {hydrateType, hydrateValue, eq} from "./util";

// Serialize

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_static/core/ssz_mainnet_random.yaml"),
  serialize,
  ({value, typeName}) => {
    const type = hydrateType((types as any)[typeName]);
    const v = hydrateValue(value, type)
    return [v, type];
  },
  ({serialized}) => {
    return serialized.slice(2)
  },
  (result) => result.toString('hex'),
);

// Deserialize

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_static/core/ssz_mainnet_random.yaml"),
  deserialize,
  ({serialized, typeName}) => {
    const type = hydrateType((types as any)[typeName]);
    return [Buffer.from(serialized.slice(2), 'hex'), type];
  },
  ({value, typeName}) => {
    const type = hydrateType((types as any)[typeName]);
    const v = hydrateValue(value, type)
    return v;
  },
  (result) => result,
  () => false,
  () => false,
  ({typeName}, expect, expected, actual) => {
    const type = hydrateType((types as any)[typeName]);
    expect(eq(type, expected, actual)).to.equal(true);
  },
);

// hashTreeRoot

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_static/core/ssz_mainnet_random.yaml"),
  hashTreeRoot,
  ({value, typeName}) => {
    const type = hydrateType((types as any)[typeName]);
    const v = hydrateValue(value, type)
    return [v, type];
  },
  ({root}) => {
    return root.slice(2)
  },
  (result) => result.toString('hex'),
);

// signingRoot

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_static/core/ssz_mainnet_random.yaml"),
  signingRoot,
  ({value, typeName}) => {
    const type = hydrateType((types as any)[typeName]);
    const v = hydrateValue(value, type)
    return [v, type];
  },
  ({root}) => {
    return root.slice(2)
  },
  (result) => result.toString('hex'),
  () => false,
  (testCase) => testCase.signingRoot
);
