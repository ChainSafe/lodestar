import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";

import {deserialize, serialize, hashTreeRoot} from "../../src";
import * as types from "../../../lodestar/src/types";

import {hydrateType, hydrateValue} from "./util";

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_static/core/ssz_mainnet_random.yaml"),
  serialize,
  ({value, typeName}) => {
    const type = hydrateType((types as any)[typeName]);
    return [hydrateValue(value, type), type];
  },
  ({serialized}) => serialized.slice(2),
  (result) => result.toString('hex'),
  () => false,
  (_, index) => index >= 50
);

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_static/core/ssz_minimal_zero.yaml"),
  serialize,
  ({value, typeName}) => {
    const type = hydrateType((types as any)[typeName]);
    return [hydrateValue(value, type), type];
  },
  ({serialized}) => serialized.slice(2),
  (result) => result.toString('hex'),
);
