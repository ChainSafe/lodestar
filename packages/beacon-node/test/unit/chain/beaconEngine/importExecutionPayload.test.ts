import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {ExecutionStatus, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {BeaconStateView, DataAvailabilityStatus, createCachedBeaconState} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {ErrorAborted, fromHex, toRootHex} from "@lodestar/utils";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {SeenEnginePayloadEnvelopeInput} from "../../../../src/chain/beaconEngine/seenEnginePayloadEnvelopeInput.js";
import {
  PayloadEnvelopeInput,
  PayloadEnvelopeInputSource,
} from "../../../../src/chain/blocks/payloadEnvelopeInput/index.js";
import {PayloadErrorCode} from "../../../../src/chain/blocks/payloadError.js";
import * as payloadVerification from "../../../../src/chain/blocks/verifyExecutionPayloadEnvelope.js";
import * as envelopeValidation from "../../../../src/chain/validation/executionPayloadEnvelope.js";
import {ZERO_HASH_HEX} from "../../../../src/constants/index.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/index.js";
import {QueueError, QueueErrorCode} from "../../../../src/util/queue/index.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {MockedBeaconChain, getMockedBeaconChain, withBeaconEngineFacade} from "../../../mocks/mockedBeaconChain.js";
import {generateState, zeroProtoBlock} from "../../../utils/state.js";

describe("BeaconEngineCore importExecutionPayload FCU", () => {
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
  const putEnvelope = vi.fn<BeaconEngineCore["db"]["executionPayloadEnvelope"]["putBinary"]>();

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
    Object.defineProperty(chain.beaconEngine, "seenPayloadEnvelopeInputCache", {
      value: new SeenEnginePayloadEnvelopeInput({config, forkChoice: chain.forkChoice, db: {block: {get: vi.fn()}}}),
    });
    chain.forkChoice.getBlockHex.mockReturnValue(null);
    chain.forkChoice.onExecutionPayload = vi.fn().mockImplementation(() => {
      const full: ProtoBlock = {
        ...zeroProtoBlock,
        blockRoot: blockRootHex,
        payloadStatus: PayloadStatus.FULL,
        executionStatus: ExecutionStatus.Valid,
        executionPayloadBlockHash: blockHashHex,
        executionPayloadNumber: 123,
        executionPayloadGasLimit: 30_000_000,
        dataAvailabilityStatus: DataAvailabilityStatus.Available,
      };
      chain.forkChoice.getBlockHex.mockReturnValue(full);
      chain.forkChoice.getBlockHexAndBlockHash.mockReturnValue(full);
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

  it.each([
    [ExecutionPayloadStatus.INVALID, PayloadErrorCode.EXECUTION_ENGINE_INVALID],
    [ExecutionPayloadStatus.UNAVAILABLE, PayloadErrorCode.EXECUTION_ENGINE_ERROR],
  ] as const)("returns typed details for %s without importing the payload", async (status, code) => {
    chain.executionEngine.notifyNewPayload.mockResolvedValue({
      status,
      latestValidHash: null,
      validationError: "EL failure",
    });
    const result = structuredClone(
      await BeaconEngineCore.prototype.importExecutionPayloadBytes.call(
        chain.beaconEngine,
        envelopeBytes,
        DataAvailabilityStatus.Available,
        {validSignature: true}
      )
    );
    expect(result).toMatchObject({err: {type: {code, execStatus: status, errorMessage: "EL failure"}, message: code}});
    expect(result.err).not.toBeInstanceOf(Error);
    expect(putEnvelope).not.toHaveBeenCalled();
    expect(chain.forkChoice.onExecutionPayload).not.toHaveBeenCalled();
    expect(chain.publishChainView).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "reuses gossip envelope decoding through import with beaconEngineWorker=%s",
    async (beaconEngineWorker) => {
      const cache = new SerializedCache();
      chain.opts.beaconEngineWorker = beaconEngineWorker;
      Object.defineProperty(chain, "serializedCache", {value: cache});
      const core: BeaconEngineCore = chain.beaconEngine;
      core.validateGossipExecutionPayloadEnvelopeBytes =
        BeaconEngineCore.prototype.validateGossipExecutionPayloadEnvelopeBytes;
      core.importExecutionPayloadBytes = BeaconEngineCore.prototype.importExecutionPayloadBytes;
      const facade = withBeaconEngineFacade(chain).beaconEngine;
      const input = PayloadEnvelopeInput.createFromBlock({
        block: ssz.gloas.SignedBeaconBlock.defaultValue(),
        blockRootHex,
        forkName: ForkName.gloas,
        sampledColumns: [],
        custodyColumns: [],
        daOutOfRange: true,
        source: PayloadEnvelopeInputSource.gossip,
        seenTimestampSec: 1,
      });
      input.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.gossip, seenTimestampSec: 1});
      const deserialize = vi.spyOn(ssz.gloas.SignedExecutionPayloadEnvelope, "deserialize");
      const serialize = vi.spyOn(ssz.gloas.SignedExecutionPayloadEnvelope, "serialize");
      const lookup = vi.spyOn(cache, "get");
      vi.spyOn(envelopeValidation, "validateGossipExecutionPayloadEnvelope").mockResolvedValue(undefined);
      expect(
        await facade.validateGossipExecutionPayloadEnvelope(envelopeBytes, envelope, {
          source: PayloadEnvelopeInputSource.gossip,
          seenTimestampSec: 1,
        })
      ).toMatchObject({err: null});
      expect(
        await facade.importExecutionPayload(input, envelopeBytes, DataAvailabilityStatus.Available, {
          validSignature: true,
        })
      ).toEqual({executionOptimistic: false});
      expect(serialize).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
      expect(deserialize).toHaveBeenCalledTimes(beaconEngineWorker ? 2 : 0);
      expect(putEnvelope.mock.calls[0][1]).toBe(envelopeBytes);
    }
  );

  async function importPayload(
    execStatus: ExecutionStatus.Valid | ExecutionStatus.Syncing = ExecutionStatus.Valid,
    candidate = envelope
  ) {
    vi.mocked(chain.executionEngine.notifyNewPayload).mockResolvedValueOnce(
      execStatus === ExecutionStatus.Valid
        ? {status: ExecutionPayloadStatus.VALID, latestValidHash: blockHashHex, validationError: null}
        : {status: ExecutionPayloadStatus.SYNCING, latestValidHash: null, validationError: null}
    );
    return BeaconEngineCore.prototype.importExecutionPayloadBytes.call(
      chain.beaconEngine,
      ssz.gloas.SignedExecutionPayloadEnvelope.serialize(candidate),
      DataAvailabilityStatus.Available,
      {validSignature: true}
    );
  }

  it("imports the payload before sending FCU with the head, safe, and finalized hashes", async () => {
    expect(await importPayload()).toMatchObject({err: null, result: {executionOptimistic: false}});
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
      chain.executionEngine.notifyForkchoiceUpdate.mock.invocationCallOrder[0]
    );
    expect(chain.publishChainView).not.toHaveBeenCalled();
  });

  it.each(["bytes", "object"] as const)(
    "does not expose FULL or send FCU until the %s envelope is persisted",
    async (inputType) => {
      let finishWrite: (() => void) | undefined;
      putEnvelope.mockReturnValue(
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        })
      );
      const deserialize = vi.spyOn(ssz.gloas.SignedExecutionPayloadEnvelope, "deserialize");
      const serialize = vi.spyOn(ssz.gloas.SignedExecutionPayloadEnvelope, "serialize");
      const candidateCacheAccess = vi.fn(() => {
        throw Error("Payload import must not access BlockSerializedCache");
      });
      Object.defineProperty(chain.beaconEngine, "blockSerializedCache", {get: candidateCacheAccess});
      const importing =
        inputType === "bytes"
          ? importPayload()
          : BeaconEngineCore.prototype.importExecutionPayload.call(
              chain.beaconEngine,
              {data: envelope, bytes: envelopeBytes},
              DataAvailabilityStatus.Available,
              {validSignature: true}
            );
      await vi.waitFor(() =>
        expect(putEnvelope).toHaveBeenCalledExactlyOnceWith(
          inputType === "object" ? blockRoot : Uint8Array.from(blockRoot),
          envelopeBytes
        )
      );
      expect(chain.forkChoice.onExecutionPayload).not.toHaveBeenCalled();
      expect(chain.publishChainView).not.toHaveBeenCalled();
      expect(chain.executionEngine.notifyForkchoiceUpdate).not.toHaveBeenCalled();
      if (inputType === "object") {
        expect(putEnvelope.mock.calls[0][1]).toBe(envelopeBytes);
        expect(chain.executionEngine.notifyNewPayload.mock.calls[0][1]).toBe(envelope.message.payload);
        expect(serialize).not.toHaveBeenCalled();
        expect(deserialize).not.toHaveBeenCalled();
      }
      finishWrite?.();
      expect(await importing).toMatchObject({
        err: null,
        result: {block: {blockRoot: Uint8Array.from(blockRoot), payloadStatus: PayloadStatus.FULL}},
      });
      expect(chain.forkChoice.onExecutionPayload).toHaveBeenCalledOnce();
      expect(chain.publishChainView).not.toHaveBeenCalled();
      expect(candidateCacheAccess).not.toHaveBeenCalled();
    }
  );

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
    expect(await importPayload(ExecutionStatus.Syncing)).toMatchObject({
      err: null,
      result: {executionOptimistic: true},
    });
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
    expect(await importPayload()).toMatchObject({err: null, result: {executionOptimistic: false}});
  });

  it("logs an EL failure without rejecting import", async () => {
    const error = new Error("EL unavailable");
    chain.executionEngine.notifyForkchoiceUpdate.mockRejectedValue(error);
    expect(await importPayload()).toMatchObject({err: null, result: {executionOptimistic: false}});
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
  it("returns detached byte metadata without publishing a Core event", async () => {
    const emit = vi.spyOn(chain.beaconEngine.emitter, "emit");
    const response = await importPayload();
    expect(response).toEqual({
      err: null,
      result: {
        executionOptimistic: false,
        block: {
          slot: zeroProtoBlock.slot,
          blockRoot: Uint8Array.from(blockRoot),
          parentRoot: fromHex(zeroProtoBlock.parentRoot),
          stateRoot: fromHex(zeroProtoBlock.stateRoot),
          parentBlockHash: null,
          payloadStatus: PayloadStatus.FULL,
          executionPayloadBlockHash: fromHex(blockHashHex),
          executionPayloadNumber: 123,
        },
      },
    });
    expect(structuredClone(response)).toEqual(response);
    expect(emit).not.toHaveBeenCalled();
    expect(chain.publishChainView).not.toHaveBeenCalled();
    if (response.err !== null) throw Error("Expected import success");
    response.result.block.blockRoot.fill(9);
    expect(envelope.message.beaconBlockRoot).toEqual(blockRoot);
    expect(chain.forkChoice.getBlockHexAndBlockHash(blockRootHex, blockHashHex)?.blockRoot).toBe(blockRootHex);
    expect(vi.mocked(chain.executionEngine.notifyNewPayload).mock.invocationCallOrder[0]).toBeLessThan(
      putEnvelope.mock.invocationCallOrder[0]
    );
  });
});
