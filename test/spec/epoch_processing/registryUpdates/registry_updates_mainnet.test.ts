import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {stateFromYaml} from "../../../utils/state";
import {expect} from "chai";
import {processRegistryUpdates} from "../../../../src/chain/stateTransition/epoch/registryUpdates";
import {equals} from "@chainsafe/ssz";
import {BeaconState} from "../../../../src/types";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/epoch_processing/registry_updates/registry_updates_mainnet.yaml"),
  processRegistryUpdates,
  (input) => {
    return [stateFromYaml(input.pre)];
  },
  (expected) => {
    return stateFromYaml(expected.post);
  },
  result => result,
  () => false,
  () => false,
  (_1, _2, expected, actual) => {
    expect(equals(expected, actual, BeaconState)).to.be.true;
  },
  0
);

