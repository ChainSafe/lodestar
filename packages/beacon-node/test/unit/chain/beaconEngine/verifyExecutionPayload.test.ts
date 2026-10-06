import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {BeaconStateView, DataAvailabilityStatus, createCachedBeaconState} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {PayloadErrorCode} from "../../../../src/chain/blocks/payloadError.js";
import * as verification from "../../../../src/chain/blocks/verifyExecutionPayloadEnvelope.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/index.js";
import {kzgCommitmentToVersionedHash} from "../../../../src/util/blobs.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {generateState, zeroProtoBlock} from "../../../utils/state.js";

const config = createBeaconConfig(
  {
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: 0,
  },
  Buffer.alloc(32)
);

describe("BeaconEngine envelope verification", () => {
  let chain: ReturnType<typeof getMockedBeaconChain>;
  const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
  const bytes = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope);
  const commitments = [Buffer.alloc(48, 7)];

  beforeEach(() => {
    chain = getMockedBeaconChain({config});
    chain.opts.disableImportExecutionFcU = true;
    Object.defineProperty(chain, "db", {
      value: {executionPayloadEnvelope: {putBinary: vi.fn().mockResolvedValue(undefined)}},
    });
    chain.forkChoice.getBlockHex.mockReturnValue(null);
    chain.forkChoice.getHead.mockReturnValue(zeroProtoBlock);
    chain.forkChoice.onExecutionPayload = vi.fn();
    const state = generateState({slot: 1}, config);
    if (!("latestExecutionPayloadBid" in state)) throw Error("Expected Gloas state");
    state.latestExecutionPayloadBid.blobKzgCommitments = ssz.gloas.BlobKzgCommitments.toViewDU(commitments);
    state.commit();
    const view = new BeaconStateView(createCachedBeaconState(state, {config, pubkeyCache}));
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(zeroProtoBlock);
    chain.regen.getBlockSlotState.mockResolvedValue(view);
    chain.regen.getClosestHeadState = vi.fn().mockResolvedValue(view);
    chain.executionEngine.notifyNewPayload = vi.fn().mockResolvedValue({status: ExecutionPayloadStatus.VALID});
    vi.spyOn(verification, "verifyExecutionPayloadEnvelope").mockReturnValue(undefined);
    vi.spyOn(verification, "verifyExecutionPayloadEnvelopeSignature").mockResolvedValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  function verify(validSignature = false) {
    return BeaconEngine.prototype.importExecutionPayload.call(
      chain.beaconEngine,
      bytes,
      0,
      DataAvailabilityStatus.Available,
      {validSignature}
    );
  }

  it("checks fields before EL/BLS and derives versioned hashes from the committed bid", async () => {
    expect(await verify()).toEqual({executionOptimistic: false});
    expect(chain.executionEngine.notifyNewPayload).toHaveBeenCalledExactlyOnceWith(
      ForkName.gloas,
      envelope.message.payload,
      commitments.map(kzgCommitmentToVersionedHash),
      envelope.message.parentBeaconBlockRoot,
      envelope.message.executionRequests
    );
    expect(vi.mocked(verification.verifyExecutionPayloadEnvelope).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(chain.executionEngine.notifyNewPayload).mock.invocationCallOrder[0]
    );
  });

  it("rejects a missing block instead of waiting for sync", async () => {
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(null);
    await expect(verify()).rejects.toMatchObject({type: {code: PayloadErrorCode.BLOCK_NOT_IN_FORK_CHOICE}});
    expect(chain.regen.getBlockSlotState).not.toHaveBeenCalled();
    expect(chain.executionEngine.notifyNewPayload).not.toHaveBeenCalled();
    expect(chain.forkChoice.onExecutionPayload).not.toHaveBeenCalled();
  });

  it.each([new Uint8Array(), bytes.subarray(0, 180)])(
    "rejects malformed envelope bytes before EL verification",
    async (malformed) => {
      await expect(
        BeaconEngine.prototype.importExecutionPayload.call(
          chain.beaconEngine,
          malformed,
          0,
          DataAvailabilityStatus.Available,
          {validSignature: false}
        )
      ).rejects.toMatchObject({type: {code: PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR}});
      expect(chain.executionEngine.notifyNewPayload).not.toHaveBeenCalled();
      expect(chain.forkChoice.onExecutionPayload).not.toHaveBeenCalled();
    }
  );

  it("retains the checkpoint-anchor state fallback", async () => {
    chain.regen.getBlockSlotState.mockRejectedValue(new Error("anchor block state unavailable"));
    await verify();
    expect(chain.regen.getClosestHeadState).toHaveBeenCalledWith(zeroProtoBlock);
  });

  it("fails before submitting malformed envelopes to EL or BLS", async () => {
    vi.mocked(verification.verifyExecutionPayloadEnvelope).mockImplementation(() => {
      throw Error("bad fields");
    });
    await expect(verify()).rejects.toMatchObject({type: {code: PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR}});
    expect(chain.executionEngine.notifyNewPayload).not.toHaveBeenCalled();
    expect(verification.verifyExecutionPayloadEnvelopeSignature).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature even if EL accepts the payload", async () => {
    vi.mocked(verification.verifyExecutionPayloadEnvelopeSignature).mockResolvedValue(false);
    await expect(verify()).rejects.toMatchObject({type: {code: PayloadErrorCode.INVALID_SIGNATURE}});
  });

  it("preserves the already-validated signature option", async () => {
    await verify(true);
    expect(verification.verifyExecutionPayloadEnvelopeSignature).not.toHaveBeenCalled();
    expect(verification.verifyExecutionPayloadEnvelope).toHaveBeenCalledWith(
      config,
      expect.anything(),
      envelope.message,
      {verifyExecutionRequestsRoot: false}
    );
  });

  it.each([ExecutionPayloadStatus.ACCEPTED, ExecutionPayloadStatus.SYNCING] as const)(
    "retains optimistic EL status %s",
    async (status) => {
      vi.mocked(chain.executionEngine.notifyNewPayload).mockResolvedValue({
        status,
        latestValidHash: null,
        validationError: null,
      });
      expect(await verify()).toMatchObject({executionOptimistic: true});
    }
  );

  it.each([
    [ExecutionPayloadStatus.INVALID, PayloadErrorCode.EXECUTION_ENGINE_INVALID],
    [ExecutionPayloadStatus.INVALID_BLOCK_HASH, PayloadErrorCode.EXECUTION_ENGINE_ERROR],
    [ExecutionPayloadStatus.ELERROR, PayloadErrorCode.EXECUTION_ENGINE_ERROR],
    [ExecutionPayloadStatus.UNAVAILABLE, PayloadErrorCode.EXECUTION_ENGINE_ERROR],
  ] as const)("preserves EL error mapping for %s", async (status, code) => {
    vi.mocked(chain.executionEngine.notifyNewPayload).mockResolvedValue({
      status,
      latestValidHash: null,
      validationError: "EL failure",
    });
    await expect(verify()).rejects.toMatchObject({type: {code, execStatus: status, errorMessage: "EL failure"}});
  });
});
