import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
import {equals} from "@chainsafe/ssz";
import {processRegistryUpdates} from "../../../../src/chain/stateTransition/epoch/registryUpdates";
import {expandYamlValue} from "../../../utils/expandYamlValue";
import {createIBeaconConfig} from "../../../../src/config";
import * as mainnetParams from "../../../../src/params/presets/mainnet";

let config = createIBeaconConfig(mainnetParams);

describeSpecTest(
  join(__dirname, "../../test-cases/tests/epoch_processing/registry_updates/registry_updates_mainnet.yaml"),
  (state) => {
    processRegistryUpdates(config, state);
    return state;
  },
  (input) => {
    return [expandYamlValue(input.pre, config.types.BeaconState)];
  },
  (expected) => {
    return expandYamlValue(expected.post, config.types.BeaconState);
  },
  result => result,
  () => false,
  () => false,
  (_1, _2, expected, actual) => {
    expect(equals(expected, actual, config.types.BeaconState)).to.be.true;
  },
  0
);

