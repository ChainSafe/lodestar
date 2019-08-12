import {join} from "path";
import {describeMultiSpec} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
import sinon from "sinon";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls";
import {equals} from "@chainsafe/ssz";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {processAttesterSlashing} from "../../../../src/chain/stateTransition/block/operations";
import {expandYamlValue} from "../../../utils/expandYamlValue";
import {AttesterSlashingCase} from "../../../utils/specTestTypes/beaconStateComparison";
import {BeaconState} from "@chainsafe/eth2.0-types";

describeMultiSpec<AttesterSlashingCase, BeaconState>(
  join(__dirname, "../../test-cases/tests/operations/attester_slashing/attester_slashing_minimal.yaml"),
  (state, attesterSlashing) => {
    processAttesterSlashing(config, state, attesterSlashing);
    return state;
  },
  (input) => {
    if(input.bls_setting && input.bls_setting.toNumber() === 2) {
      rewire({
        verify: sinon.stub().returns(true),
        verifyMultiple: sinon.stub().returns(true),
        aggregatePubkeys: sinon.stub().returns(Buffer.alloc(48))
      });
    }
    return [expandYamlValue(input.pre, config.types.BeaconState), expandYamlValue(input.attesterSlashing, config.types.AttesterSlashing)];
  },
  (expected) => {
    return expandYamlValue(expected.post, config.types.BeaconState);
  },
  result => result,
  (testCase) => {
    return !testCase.post;
  },
  () => false,
  (_1, _2, expected, actual) => {
    expect(equals(expected, actual, config.types.BeaconState)).to.be.true;
    restore();
  },
  0
);

