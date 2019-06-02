import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {stateFromYaml} from "../../../utils/state";
import {expect} from "chai";
import {processAttestation} from "../../../../src/chain/stateTransition/block/attestations";
import {attestationFromYaml} from "../../../utils/attestation";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/operations/attestation/attestation_mainnet.yaml"),
  processAttestation,
  (input) => {
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
    expect(expected).to.be.deep.equal(actual);
  }
);

