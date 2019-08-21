import {join} from "path";
import {describeMultiSpec} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls";
import sinon from "sinon";
import {equals} from "@chainsafe/ssz";

import {Attestation, BeaconState} from "@chainsafe/eth2.0-types";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {processAttestation} from "../../../../src/chain/stateTransition/block/operations";
import {expandYamlValue} from "../../../utils/expandYamlValue";
import {AttestationCase} from "../../../utils/specTestTypes/beaconStateComparison";

describeMultiSpec<AttestationCase, BeaconState>(
  join(__dirname, "../../test-cases/tests/operations/attestation/attestation_mainnet.yaml"),
  (state: BeaconState, attestation: Attestation): BeaconState => {
    processAttestation(config, state, attestation);
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
    return [expandYamlValue(input.pre, config.types.BeaconState), expandYamlValue(input.attestation, config.types.Attestation)];
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

