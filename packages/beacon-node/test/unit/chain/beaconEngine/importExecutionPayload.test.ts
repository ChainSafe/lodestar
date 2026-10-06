import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {ExecutionStatus, PayloadStatus} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {BeaconStateView, DataAvailabilityStatus, createCachedBeaconState} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {ErrorAborted, toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconEngineEvent} from "../../../../src/chain/beaconEngine/events.js";
import * as payloadVerification from "../../../../src/chain/blocks/verifyExecutionPayloadEnvelope.js";
import {ZERO_HASH_HEX} from "../../../../src/constants/index.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/index.js";
import {QueueError, QueueErrorCode} from "../../../../src/util/queue/index.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {generateState, zeroProtoBlock} from "../../../utils/state.js";

describe("BeaconEngine importExecutionPayload FCU", () => {
  const blockRoot = Buffer.alloc(32, 1);
  const blockRootHex = toRootHex(blockRoot);
  const blockHashHex = toRootHex(Buffer.alloc(32, 2));
  const finalizedBlockHash = toRootHex(Buffer.alloc(32, 3));
  let chain: MockedBeaconChain;
  const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
  envelope.message.beaconBlockRoot = blockRoot;
  envelope.message.payload.blockHash = Buffer.alloc(32, 2);
  envelope.message.payload.blockNumber = 123;
  envelope.message.payload.gasLimit = 30_000_000;
  const envelopeBytes = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope);
  const emitImported = vi.fn();
  const putEnvelope = vi.fn<BeaconEngine["db"]["executionPayloadEnvelope"]["putBinary"]>();

  beforeEach(() => {
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
    chain = getMockedBeaconChain({config});
    const state = new BeaconStateView(createCachedBeaconState(generateState({slot: 1}, config), {config, pubkeyCache}));
    chain.regen.getBlockSlotState.mockResolvedValue(state);
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(zeroProtoBlock);
    chain.executionEngine.notifyNewPayload = vi.fn().mockResolvedValue({status: ExecutionPayloadStatus.VALID});
    putEnvelope.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(chain, "db", {value: {executionPayloadEnvelope: {putBinary: putEnvelope}}});
    emitImported.mockReset();
    chain.beaconEngine.events.on(BeaconEngineEvent.executionPayloadImported, emitImported);
    chain.forkChoice.getBlockHex.mockReturnValue(null);
    chain.forkChoice.onExecutionPayload = vi.fn().mockImplementation(() => {
      chain.forkChoice.getBlockHex.mockReturnValue({
        ...zeroProtoBlock,
        payloadStatus: PayloadStatus.FULL,
        executionStatus: ExecutionStatus.Valid,
        executionPayloadBlockHash: blockHashHex,
        executionPayloadNumber: 123,
        executionPayloadGasLimit: 30_000_000,
        dataAvailabilityStatus: DataAvailabilityStatus.Available,
      });
    });
    vi.spyOn(payloadVerification, "verifyExecutionPayloadEnvelope").mockReturnValue(undefined);
    chain.forkChoice.getConfirmedBlock.mockReturnValue(zeroProtoBlock);
    chain.forkChoice.getHead.mockReturnValue({...zeroProtoBlock, blockRoot: blockRootHex});
    chain.forkChoice.getFinalizedBlock.mockReturnValue({
      ...zeroProtoBlock,
      slot: 1,
      executionStatus: ExecutionStatus.Valid,
      executionPayloadBlockHash: finalizedBlockHash,
      executionPayloadNumber: 100,
      executionPayloadGasLimit: 30_000_000,
      dataAvailabilityStatus: DataAvailabilityStatus.Available,
    });
    chain.executionEngine.notifyForkchoiceUpdate.mockResolvedValue(null);
    vi.spyOn(chain.config, "getForkName").mockReturnValue(ForkName.gloas);
  });

  afterEach(() => vi.restoreAllMocks());

  async function importPayload(
    execStatus: ExecutionStatus.Valid | ExecutionStatus.Syncing = ExecutionStatus.Valid,
    candidate = envelope
  ) {
    vi.mocked(chain.executionEngine.notifyNewPayload).mockResolvedValueOnce(
      execStatus === ExecutionStatus.Valid
        ? {status: ExecutionPayloadStatus.VALID, latestValidHash: blockHashHex, validationError: null}
        : {status: ExecutionPayloadStatus.SYNCING, latestValidHash: null, validationError: null}
    );
    return BeaconEngine.prototype.importExecutionPayload.call(
      chain.beaconEngine,
      ssz.gloas.SignedExecutionPayloadEnvelope.serialize(candidate),
      0,
      DataAvailabilityStatus.Available,
      {validSignature: true}
    );
  }

  it("imports the payload before sending FCU with the head, safe, and finalized hashes", async () => {
    expect(await importPayload()).toEqual({executionOptimistic: false});
    expect(chain.forkChoice.onExecutionPayload).toHaveBeenCalledWith(
      blockRootHex,
      blockHashHex,
      123,
      30_000_000,
      ExecutionStatus.Valid,
      DataAvailabilityStatus.Available
    );
    expect(chain.executionEngine.notifyForkchoiceUpdate).toHaveBeenCalledExactlyOnceWith(
      ForkName.gloas,
      blockHashHex,
      ZERO_HASH_HEX,
      finalizedBlockHash
    );
    expect(chain.forkChoice.onExecutionPayload.mock.invocationCallOrder[0]).toBeLessThan(
      chain.publishChainView.mock.invocationCallOrder[0]
    );
    expect(chain.publishChainView.mock.invocationCallOrder[0]).toBeLessThan(
      chain.executionEngine.notifyForkchoiceUpdate.mock.invocationCallOrder[0]
    );
  });

  it("does not expose FULL or send FCU until the envelope is persisted", async () => {
    let finishWrite: (() => void) | undefined;
    putEnvelope.mockReturnValue(
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      })
    );
    const importing = importPayload();
    await vi.waitFor(() =>
      expect(putEnvelope).toHaveBeenCalledExactlyOnceWith(Uint8Array.from(blockRoot), envelopeBytes)
    );
    expect(emitImported).not.toHaveBeenCalled();
    expect(chain.forkChoice.onExecutionPayload).not.toHaveBeenCalled();
    expect(chain.publishChainView).not.toHaveBeenCalled();
    expect(chain.executionEngine.notifyForkchoiceUpdate).not.toHaveBeenCalled();
    finishWrite?.();
    await importing;
    expect(chain.forkChoice.onExecutionPayload).toHaveBeenCalledOnce();
    expect(emitImported).toHaveBeenCalledOnce();
  });

  it("rejects a failed envelope write without exposing FULL or sending FCU", async () => {
    const error = new Error("DB write failed");
    putEnvelope.mockRejectedValue(error);
    await expect(importPayload()).rejects.toBe(error);
    expect(chain.forkChoice.onExecutionPayload).not.toHaveBeenCalled();
    expect(chain.publishChainView).not.toHaveBeenCalled();
    expect(chain.executionEngine.notifyForkchoiceUpdate).not.toHaveBeenCalled();
  });

  it("imports without FCU when import updates are disabled", async () => {
    chain.opts.disableImportExecutionFcU = true;
    expect(await importPayload(ExecutionStatus.Syncing)).toEqual({executionOptimistic: true});
    expect(chain.forkChoice.onExecutionPayload).toHaveBeenCalledOnce();
    expect(chain.executionEngine.notifyForkchoiceUpdate).not.toHaveBeenCalled();
  });

  it("does not send FCU for a non-head payload", async () => {
    chain.forkChoice.getHead.mockReturnValue(zeroProtoBlock);
    await importPayload();
    expect(chain.executionEngine.notifyForkchoiceUpdate).not.toHaveBeenCalled();
  });

  it("does not wait for the EL response", async () => {
    chain.executionEngine.notifyForkchoiceUpdate.mockReturnValue(new Promise(() => {}));
    expect(await importPayload()).toEqual({executionOptimistic: false});
  });

  it("logs an EL failure without rejecting import", async () => {
    const error = new Error("EL unavailable");
    chain.executionEngine.notifyForkchoiceUpdate.mockRejectedValue(error);
    expect(await importPayload()).toEqual({executionOptimistic: false});
    await Promise.resolve();
    expect(chain.logger.error).toHaveBeenCalledWith(
      "Error pushing notifyForkchoiceUpdate()",
      {blockHashHex, finalizedBlockHash},
      error
    );
  });

  it.each([new ErrorAborted(), new QueueError({code: QueueErrorCode.QUEUE_ABORTED})])(
    "suppresses shutdown errors: %s",
    async (error) => {
      chain.executionEngine.notifyForkchoiceUpdate.mockRejectedValue(error);
      await importPayload();
      await Promise.resolve();
      expect(chain.logger.error).not.toHaveBeenCalled();
    }
  );
  it("emits detached import metadata after verification and persistence", async () => {
    await importPayload();
    expect(emitImported).toHaveBeenCalledExactlyOnceWith({
      slot: envelope.message.payload.slotNumber,
      builderIndex: envelope.message.builderIndex,
      blockRoot: blockRootHex,
      blockHash: blockHashHex,
      executionOptimistic: false,
    });
    expect(vi.mocked(chain.executionEngine.notifyNewPayload).mock.invocationCallOrder[0]).toBeLessThan(
      putEnvelope.mock.invocationCallOrder[0]
    );
  });
});
