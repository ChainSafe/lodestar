import {ForkChoiceError, ForkChoiceErrorCode, InvalidAttestationCode} from "@chainsafe/lodestar-fork-choice";
import {expect} from "chai";
import {IAttestationJob} from "../../../../src/chain";
import {mapAttestationError, needProcessPendingAttestations} from "../../../../src/chain/attestation";
import {AttestationErrorCode} from "../../../../src/chain/errors";
import {generateEmptyAttestation} from "../../../utils/attestation";

describe("needProcessPendingAttestations", function () {
  const testCases: {numJob: number; numProcess: number | null; numRemaining: number}[] = [
    {numJob: 4, numProcess: null, numRemaining: 4},
    {numJob: 5, numProcess: 5, numRemaining: 0},
    {numJob: 6, numProcess: 5, numRemaining: 1},
  ];
  for (const {numJob, numProcess, numRemaining} of testCases) {
    it(`should return ${numProcess} jobs to process, remaining ${numRemaining}`, () => {
      const pendingAttestationJobs: IAttestationJob[] = Array.from({length: numJob}, () => ({
        attestation: generateEmptyAttestation(),
        validSignature: false,
      }));

      if (!numProcess) {
        expect(needProcessPendingAttestations(pendingAttestationJobs, 5), "should return null").to.be.null;
      } else {
        expect(
          needProcessPendingAttestations(pendingAttestationJobs, 5)?.length,
          `should return ${numProcess} jobs to process`
        ).to.be.equal(numProcess);
      }
      expect(pendingAttestationJobs.length, `remaining jobs should be ${numRemaining}`).to.be.equal(numRemaining);
    });
  }
});

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
