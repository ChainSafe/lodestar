import {ForkChoiceError, ForkChoiceErrorCode, InvalidAttestationCode} from "@chainsafe/lodestar-fork-choice";
import {expect} from "chai";
import {IAttestationJob} from "../../../../src/chain";
import {mapAttestationError} from "../../../../src/chain/attestation";
import {AttestationErrorCode} from "../../../../src/chain/errors";
import {generateEmptyAttestation} from "../../../utils/attestation";

describe("Attestation Processor", function () {
  it("mapAttestationError", function () {
    const forkchoiceError = new ForkChoiceError({
      code: ForkChoiceErrorCode.INVALID_ATTESTATION,
      err: {
        code: InvalidAttestationCode.FUTURE_EPOCH,
        attestationEpoch: 2025,
        currentEpoch: 2021,
      },
    });
    forkchoiceError.stack = "error from unit test";

    const job: IAttestationJob = {
      attestation: generateEmptyAttestation(),
      validSignature: false,
    };

    const lodestarError = mapAttestationError(forkchoiceError, job);
    expect(lodestarError?.type.code).to.be.equal(AttestationErrorCode.FUTURE_EPOCH);
    if (lodestarError?.type.code === AttestationErrorCode.FUTURE_EPOCH) {
      expect(lodestarError.type.attestationEpoch).to.be.equal(2025);
      expect(lodestarError.type.currentEpoch).to.be.equal(2021);
      expect(lodestarError.stack).to.be.equal("error from unit test");
    }
  });
});
