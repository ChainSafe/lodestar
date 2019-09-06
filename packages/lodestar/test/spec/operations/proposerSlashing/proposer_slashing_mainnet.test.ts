import {join} from "path";
import {expect} from "chai";
import {equals} from "@chainsafe/ssz";
import {BeaconState} from "@chainsafe/eth2.0-types";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {processProposerSlashing} from "../../../../src/chain/stateTransition/block/operations";
import {describeDirectorySpecTest} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {ProcessProposerSlashingTestCase} from "./type";

describeDirectorySpecTest<ProcessProposerSlashingTestCase, BeaconState>(
  "process proposer slashing mainnet",
  join(__dirname, "../../../../../spec-test-cases/tests/mainnet/phase0/operations/proposer_slashing/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    processProposerSlashing(config, state, testcase.proposer_slashing);
    return state;
  },
  {
    sszTypes: {
      pre: config.types.BeaconState,
      post: config.types.BeaconState,
      // eslint-disable-next-line @typescript-eslint/camelcase
      proposer_slashing: config.types.ProposerSlashing,
    },
    timeout: 100000000,
    shouldError: testCase => !testCase.post,
    getExpected: (testCase => testCase.post),
    expectFunc: (testCase, expected, actual) => {
      expect(equals(actual, expected, config.types.BeaconState)).to.be.true;
    }
  }
);

