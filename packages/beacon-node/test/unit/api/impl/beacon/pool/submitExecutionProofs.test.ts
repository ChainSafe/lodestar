import {beforeEach, describe, expect, it, vi} from "vitest";
import {ssz} from "@lodestar/types";
import {getBeaconPoolApi} from "../../../../../../src/api/impl/beacon/pool/index.js";
import {IndexedError} from "../../../../../../src/api/impl/errors.js";
import {ExecutionProofError, ExecutionProofErrorCode, GossipAction} from "../../../../../../src/chain/errors/index.js";
import {validateApiExecutionProof} from "../../../../../../src/chain/validation/executionProof.js";
import {INetwork} from "../../../../../../src/network/interface.js";
import {ClockStopped} from "../../../../../mocks/clock.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";

vi.mock("../../../../../../src/chain/validation/executionProof.js", () => ({
  validateApiExecutionProof: vi.fn(),
}));

describe("api - beacon - submitExecutionProofs", () => {
  let modules: ApiTestModules;
  let api: ReturnType<typeof getBeaconPoolApi>;
  let publishExecutionProof: ReturnType<typeof vi.fn<INetwork["publishExecutionProof"]>>;

  const proofEnvelope = () => {
    const signed = ssz.eip8025.SignedExecutionProofEnvelope.defaultValue();
    signed.message.proofType = 1;
    signed.message.proofData = Uint8Array.from([1]);
    return signed;
  };

  beforeEach(() => {
    vi.mocked(validateApiExecutionProof).mockReset();
    modules = getApiTestModules();
    Object.defineProperties(modules.chain, {clock: {value: new ClockStopped(8)}});
    publishExecutionProof = vi.fn<INetwork["publishExecutionProof"]>().mockResolvedValue(1);
    modules.network.publishExecutionProof = publishExecutionProof;
    api = getBeaconPoolApi(modules);
  });

  it("validates then broadcasts each proof", async () => {
    vi.mocked(validateApiExecutionProof).mockResolvedValue({blockSlot: 8});
    const proofs = [proofEnvelope(), proofEnvelope()];

    await api.submitExecutionProofs({signedExecutionProofEnvelopes: proofs});

    expect(validateApiExecutionProof).toHaveBeenCalledTimes(2);
    expect(publishExecutionProof).toHaveBeenCalledTimes(2);
    expect(publishExecutionProof).toHaveBeenCalledWith(proofs[0], 8);
  });

  it("treats already processed proofs as success without broadcasting", async () => {
    vi.mocked(validateApiExecutionProof).mockRejectedValue(
      new ExecutionProofError(GossipAction.IGNORE, {
        code: ExecutionProofErrorCode.PROOF_ALREADY_KNOWN,
        blockRoot: "0x00",
        proofType: 1,
      })
    );

    await api.submitExecutionProofs({signedExecutionProofEnvelopes: [proofEnvelope()]});

    expect(publishExecutionProof).not.toHaveBeenCalled();
  });

  it("reports rejected proofs by index and persists them", async () => {
    vi.mocked(validateApiExecutionProof)
      .mockResolvedValueOnce({blockSlot: 8})
      .mockRejectedValueOnce(
        new ExecutionProofError(GossipAction.REJECT, {
          code: ExecutionProofErrorCode.INVALID_PROOF,
          blockRoot: "0x00",
          proofType: 1,
          validatorIndex: 0,
        })
      );

    await expect(
      api.submitExecutionProofs({signedExecutionProofEnvelopes: [proofEnvelope(), proofEnvelope()]})
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof IndexedError && e.failures.length === 1 && e.failures[0].index === 1
    );

    expect(publishExecutionProof).toHaveBeenCalledTimes(1);
    expect(modules.chain.persistInvalidSszValue).toHaveBeenCalledOnce();
  });
});
