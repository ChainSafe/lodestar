import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
import {processRegistryUpdates} from "../../../../src/chain/stateTransition/epoch/registryUpdates";
import {BeaconState} from "@chainsafe/eth2-types";
import {expandYamlValue} from "../../../utils/expandYamlValue";
import {equals} from "@chainsafe/ssz";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/epoch_processing/registry_updates/registry_updates_mainnet.yaml"),
  processRegistryUpdates,
  (input) => {
    return [expandYamlValue(input.pre, BeaconState)];
  },
  (expected) => {
    return expandYamlValue(expected.post, BeaconState);
  },
  result => result,
  () => false,
  () => false,
  (_1, _2, expected, actual) => {
    expect(equals(expected, actual, BeaconState)).to.be.true;
  },
  0
);

