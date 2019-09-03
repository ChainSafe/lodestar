import {join} from "path";
import {describeMultiSpec} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
// @ts-ignore
import {equals} from "@chainsafe/ssz";

import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {initializeBeaconStateFromEth1} from "../../../../src/chain/genesis/genesis";
import {expandYamlValue} from "../../../utils/expandYamlValue";
import {BeaconState} from "@chainsafe/eth2.0-types";
import {GenesisInitCase} from "../../../utils/specTestTypes/genesis";
import {DEPOSIT_CONTRACT_TREE_DEPTH} from "@chainsafe/eth2.0-params/lib/presets/minimal";

describeMultiSpec<GenesisInitCase, BeaconState>(
  join(__dirname, "../../test-cases/tests/genesis/initialization/genesis_initialization_minimal.yaml"),
  (blockHash, timestamp, deposits) => {
    return initializeBeaconStateFromEth1(config, blockHash, timestamp, deposits);
  },
  (input) => {
    return [
      expandYamlValue(input.eth1BlockHash, config.types.Hash),
      expandYamlValue(input.eth1Timestamp, config.types.number64),
      expandYamlValue(input.deposits, {
        elementType: config.types.Deposit,
        maxLength: 2 ^ DEPOSIT_CONTRACT_TREE_DEPTH,
      }),
    ];
  },
  (expected) => {
    return expandYamlValue(expected.state, config.types.BeaconState);
  },
  result => result,
  (testCase) => {
    return !testCase.state;
  },
  () => false,
  (_1, _2, expected: BeaconState, actual: BeaconState) => {
    expect(equals(expected, actual, config.types.BeaconState)).to.be.true;
  },
  0
);

