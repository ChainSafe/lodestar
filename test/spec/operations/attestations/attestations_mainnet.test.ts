import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {stateFromYaml} from "../../../utils/state";
import {expect} from "chai";
import {processAttestation} from "../../../../src/chain/stateTransition/block/attestations";
import {attestationFromYaml} from "../../../utils/attestation";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";
import sinon from "sinon";
import {equals} from "@chainsafe/ssz";
import {BeaconState} from "../../../../src/types";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/operations/attestation/attestation_mainnet.yaml"),
  processAttestation,
  (input) => {
    if(input.bls_setting && input.bls_setting.toNumber() === 2) {
      rewire({
        verify: sinon.stub().returns(true),
        verifyMultiple: sinon.stub().returns(true),
        aggregatePubkeys: sinon.stub().returns(Buffer.alloc(48))
      });
    }
    return [stateFromYaml(input.pre), attestationFromYaml(input.attestation)];
  },
  (expected) => {
    return stateFromYaml(expected.post);
  },
  result => result,
  (testCase) => {
    return !testCase.post;
  },
  () => false,
  (_1, _2, expected, actual) => {
    expect(equals(expected, actual, BeaconState)).to.be.true;
    restore();
  },
  0
);

