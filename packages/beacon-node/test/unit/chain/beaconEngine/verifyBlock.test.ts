import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ExecutionStatus, PayloadStatus} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {BeaconStateView, DataAvailabilityStatus} from "@lodestar/state-transition";
import {bellatrix, ssz, sszTypesFor} from "@lodestar/types";
import {ErrorAborted, defer, fromHex, toRootHex} from "@lodestar/utils";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {verifyBlocks as verifyEngineBlocks} from "../../../../src/chain/beaconEngine/verifyBlock.js";
import {
  BlockInputBlobs,
  BlockInputNoData,
  BlockInputPreData,
} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource, IBlockInput} from "../../../../src/chain/blocks/blockInput/index.js";
import {BlockBytes} from "../../../../src/chain/blocks/blockSerializedCache.js";
import {verifyBlocksInEpoch} from "../../../../src/chain/blocks/verifyBlock.js";
import * as executionVerification from "../../../../src/chain/blocks/verifyBlocksExecutionPayloads.js";
import {
  verifyBlockExecutionPayload,
  verifyBlocksExecutionPayload,
} from "../../../../src/chain/blocks/verifyBlocksExecutionPayloads.js";
import * as signatureVerification from "../../../../src/chain/blocks/verifyBlocksSignatures.js";
import * as stf from "../../../../src/chain/blocks/verifyBlocksStateTransitionOnly.js";
import {BlockErrorCode} from "../../../../src/chain/errors/index.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/engine/interface.js";
import {kzgCommitmentToVersionedHash} from "../../../../src/util/blobs.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {generateCachedBellatrixState, zeroProtoBlock} from "../../../utils/state.js";

function bellatrixInput(enabled = false) {
  const block = ssz.bellatrix.SignedBeaconBlock.defaultValue();
  if (enabled) block.message.body.executionPayload.blockHash = Buffer.alloc(32, 1);
  return BlockInputPreData.createFromBlock({
    block,
    blockRootHex: toRootHex(ssz.bellatrix.BeaconBlock.hashTreeRoot(block.message)),
    forkName: ForkName.bellatrix,
    daOutOfRange: false,
    source: BlockInputSource.gossip,
    seenTimestampSec: 0,
  });
}

function serializeBlocks(...inputs: IBlockInput[]): BlockBytes[] {
  return inputs.map((input) => ({
    blockRoot: fromHex(input.blockRootHex),
    blockBytes: sszTypesFor(input.forkName).SignedBeaconBlock.serialize(input.getBlock()),
  }));
}

describe("BeaconEngineCore block execution verification", () => {
  let chain: ReturnType<typeof getMockedBeaconChain>;
  let state: BeaconStateView;
  let signal: AbortSignal;

  beforeEach(() => {
    signal = new AbortController().signal;
    chain = getMockedBeaconChain({config: createBeaconConfig(getConfig(ForkName.bellatrix), Buffer.alloc(32))});
    const cachedState = generateCachedBellatrixState();
    cachedState.latestExecutionPayloadHeader = ssz.bellatrix.ExecutionPayloadHeader.toViewDU(
      ssz.bellatrix.ExecutionPayloadHeader.defaultValue()
    );
    state = new BeaconStateView(cachedState);
    Object.defineProperty(chain.beaconEngine, "verifiedBlocks", {value: new Map(), configurable: true});
    chain.forkChoice.validateLatestHash = vi.fn();
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(zeroProtoBlock);
    chain.regen.getPreState.mockResolvedValue(state);
    chain.beaconEngine.verifyBlocks = vi.fn(BeaconEngineCore.prototype.verifyBlocks.bind(chain.beaconEngine));
    chain.executionEngine.notifyNewPayload = vi.fn().mockResolvedValue({
      status: ExecutionPayloadStatus.VALID,
      latestValidHash: toRootHex(Buffer.alloc(32, 1)),
      validationError: null,
    });
    vi.spyOn(stf, "verifyBlocksStateTransitionOnly").mockResolvedValue({
      postStates: [state],
      proposerBalanceDeltas: [0],
      verifyStateTime: 0,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([false, true])("resolves block bytes with an existing decoded entry: %s", async (cached) => {
    const input = bellatrixInput();
    const block = input.getBlock();
    const [{blockRoot, blockBytes: bytes}] = serializeBlocks(input);
    if (cached) chain.blockSerializedCache.set(input.blockRootHex, block, bytes);
    const deserialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "deserialize");
    const opts = structuredClone({validSignatures: true});
    await chain.beaconEngine.verifyBlocks([{blockRoot, blockBytes: bytes}], opts, signal);
    const verifiedBlock = chain.beaconEngine.verifiedBlocks.get(input.blockRootHex)?.block;
    expect(verifiedBlock).toEqual(block);
    if (cached) {
      expect(verifiedBlock).toBe(block);
      expect(deserialize).not.toHaveBeenCalled();
    } else {
      expect(verifiedBlock).not.toBe(block);
      expect(verifiedBlock?.signature.buffer).toBe(bytes.buffer);
      expect(deserialize).toHaveBeenCalledExactlyOnceWith(bytes, {reuseBytes: true});
    }
    await chain.beaconEngine.verifyBlocks([{blockRoot, blockBytes: Uint8Array.from(bytes)}], opts, signal);
    expect(deserialize).toHaveBeenCalledTimes(cached ? 0 : 1);
    expect(chain.beaconEngine.verifiedBlocks.get(input.blockRootHex)?.block).toBe(verifiedBlock);
    expect(chain.beaconEngine.verifiedBlocks.get(input.blockRootHex)?.blockBytes).toBe(bytes);
  });

  it("honors the caller's AbortSignal while pre-state regeneration is pending", async () => {
    const preState = defer<BeaconStateView>();
    chain.regen.getPreState.mockReturnValueOnce(preState.promise);
    const bytes = serializeBlocks(bellatrixInput());
    const opts = structuredClone({validSignatures: true});
    const controller = new AbortController();
    const verification = chain.beaconEngine.verifyBlocks(bytes, opts, controller.signal);
    const rejected = expect(verification).rejects.toBeInstanceOf(ErrorAborted);
    controller.abort();
    preState.resolve(state);
    await rejected;
    expect(stf.verifyBlocksStateTransitionOnly).not.toHaveBeenCalled();
    expect(chain.beaconEngine.verifiedBlocks.size).toBe(0);
    await chain.beaconEngine.verifyBlocks(bytes, opts, signal);
    expect(chain.beaconEngine.verifiedBlocks.size).toBe(1);
  });

  it("validates an API block without retaining an import bundle or submitting its payload to the EL", async () => {
    const [{blockRoot, blockBytes}] = serializeBlocks(bellatrixInput(true));
    await chain.beaconEngine.validateApiBlock(blockRoot, blockBytes, {validSignatures: true}, signal);
    expect(stf.verifyBlocksStateTransitionOnly).toHaveBeenCalledOnce();
    expect(chain.executionEngine.notifyNewPayload).not.toHaveBeenCalled();
    expect(chain.beaconEngine.verifiedBlocks.size).toBe(0);
  });

  it.each([false, true])("preserves a pending import bundle during API validation (failure: %s)", async (failure) => {
    const [data] = serializeBlocks(bellatrixInput());
    await chain.beaconEngine.verifyBlocks([data], {validSignatures: true}, signal);
    const pending = chain.beaconEngine.verifiedBlocks.get(toRootHex(data.blockRoot));
    const error = new Error("API state transition failed");
    if (failure) vi.mocked(stf.verifyBlocksStateTransitionOnly).mockRejectedValueOnce(error);

    const validating = chain.beaconEngine.validateApiBlock(
      data.blockRoot,
      data.blockBytes,
      {validSignatures: true},
      signal
    );
    if (failure) await expect(validating).rejects.toBe(error);
    else await validating;

    expect(chain.beaconEngine.verifiedBlocks.get(toRootHex(data.blockRoot))).toBe(pending);
  });

  it("rejects malformed block bytes before regenerating state", async () => {
    await expect(
      chain.beaconEngine.verifyBlocks([{blockRoot: new Uint8Array(32), blockBytes: new Uint8Array()}], {}, signal)
    ).rejects.toMatchObject({
      type: {code: "INVALID_BLOCK_SSZ"},
    });
    expect(chain.regen.getPreState).not.toHaveBeenCalled();
  });

  it("registers serialization fallback bytes so facade verification reuses the original block", async () => {
    const input = bellatrixInput();
    const block = input.getBlock();
    const deserialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "deserialize");
    await verifyBlocksInEpoch.call(chain, zeroProtoBlock, [input], null, {validSignatures: true});
    expect(deserialize).not.toHaveBeenCalled();
    expect(chain.beaconEngine.verifiedBlocks.get(input.blockRootHex)?.block).toBe(block);
    expect(chain.beaconEngine.verifiedBlocks.get(input.blockRootHex)?.blockBytes).toBe(
      chain.blockSerializedCache.get(input.blockRootHex)?.bytes
    );
  });

  it("rejects a parent missing from the engine before regenerating state", async () => {
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(null);
    await expect(chain.beaconEngine.verifyBlocks(serializeBlocks(bellatrixInput()), {}, signal)).rejects.toMatchObject({
      type: {code: BlockErrorCode.PARENT_BLOCK_UNKNOWN},
    });
    expect(chain.regen.getPreState).not.toHaveBeenCalled();
  });

  it.each([PayloadStatus.EMPTY, PayloadStatus.FULL, null])(
    "resolves the Gloas parent in the engine (available variant: %s)",
    async (status) => {
      vi.spyOn(chain.config, "getForkTypes").mockReturnValue(
        createBeaconConfig(getConfig(ForkName.gloas), Buffer.alloc(32)).getForkTypes(0)
      );
      const block = ssz.gloas.SignedBeaconBlock.defaultValue();
      block.message.parentRoot = Buffer.alloc(32, 2);
      block.message.body.signedExecutionPayloadBid.message.parentBlockHash = Buffer.alloc(32, 3);
      const input = BlockInputNoData.createFromBlock({
        block,
        blockRootHex: toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message)),
        forkName: ForkName.gloas,
        daOutOfRange: false,
        source: BlockInputSource.byRange,
        seenTimestampSec: 0,
      });
      const pending = {...zeroProtoBlock, payloadStatus: PayloadStatus.PENDING};
      const variant = status === null ? null : {...zeroProtoBlock, payloadStatus: status};
      chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(pending);
      chain.forkChoice.getBlockHexAndBlockHash.mockReturnValue(variant);
      const execution = vi.spyOn(executionVerification, "verifyBlocksExecutionPayload").mockResolvedValue({
        execAborted: null,
        executionStatuses: [ExecutionStatus.Syncing],
        executionTime: 0,
      });
      await verifyEngineBlocks.call(
        chain.beaconEngine,
        serializeBlocks(input),
        {validSignatures: true},
        new AbortController().signal
      );
      expect(chain.forkChoice.getBlockHexAndBlockHash).toHaveBeenCalledWith(
        toRootHex(block.message.parentRoot),
        toRootHex(block.message.body.signedExecutionPayloadBid.message.parentBlockHash)
      );
      expect(execution.mock.calls[0][1]).toBe(variant ?? pending);
    }
  );

  it("does not submit an empty pre-merge Bellatrix payload", async () => {
    expect(await verifyBlockExecutionPayload(chain, bellatrixInput().getBlock(), state)).toMatchObject({
      executionStatus: ExecutionStatus.PreMerge,
    });
    expect(chain.executionEngine.notifyNewPayload).not.toHaveBeenCalled();
  });

  it("submits the transition payload when execution becomes enabled", async () => {
    const input = bellatrixInput(true);
    expect(await verifyBlockExecutionPayload(chain, input.getBlock(), state)).toMatchObject({
      executionStatus: ExecutionStatus.Valid,
    });
    expect(chain.executionEngine.notifyNewPayload).toHaveBeenCalledOnce();
  });

  it("derives Deneb hashes from the block even when facade hashes differ", async () => {
    vi.spyOn(chain.config, "getForkName").mockReturnValue(ForkName.deneb);
    const block = ssz.deneb.SignedBeaconBlock.defaultValue();
    block.message.body.executionPayload.blockHash = Buffer.alloc(32, 1);
    block.message.body.blobKzgCommitments = [Buffer.alloc(48, 2)];
    const input = BlockInputBlobs.createFromBlock({
      block,
      blockRootHex: toRootHex(ssz.deneb.BeaconBlock.hashTreeRoot(block.message)),
      forkName: ForkName.deneb,
      daOutOfRange: false,
      source: BlockInputSource.gossip,
      seenTimestampSec: 0,
    });
    const facadeHashes = vi.spyOn(input, "getVersionedHashes").mockReturnValue([Buffer.alloc(32, 3)]);
    await verifyBlockExecutionPayload(chain, input.getBlock(), state);
    expect(chain.executionEngine.notifyNewPayload).toHaveBeenCalledExactlyOnceWith(
      ForkName.deneb,
      block.message.body.executionPayload,
      block.message.body.blobKzgCommitments.map(kzgCommitmentToVersionedHash),
      block.message.parentRoot,
      undefined
    );
    expect(facadeHashes).not.toHaveBeenCalled();
  });

  it.each([
    [ExecutionPayloadStatus.VALID, ExecutionStatus.Valid],
    [ExecutionPayloadStatus.SYNCING, ExecutionStatus.Syncing],
    [ExecutionPayloadStatus.ACCEPTED, ExecutionStatus.Syncing],
  ] as const)("retains %s status in the engine verification bundle", async (status, expected) => {
    const input = bellatrixInput(true);
    chain.executionEngine.notifyNewPayload.mockResolvedValue(
      status === ExecutionPayloadStatus.VALID
        ? {status, latestValidHash: toRootHex(Buffer.alloc(32, 1)), validationError: null}
        : {status, latestValidHash: null, validationError: null}
    );
    const blockBytes = ssz.bellatrix.SignedBeaconBlock.serialize(input.getBlock() as bellatrix.SignedBeaconBlock);
    const result = await chain.beaconEngine.verifyBlocks(
      [{blockRoot: fromHex(input.blockRootHex), blockBytes}],
      {validSignatures: true},
      signal
    );
    expect(result.segmentExecStatus).toMatchObject({executionStatuses: [expected]});
    expect(chain.beaconEngine.verifiedBlocks.get(input.blockRootHex)?.executionStatus).toBe(expected);
    expect(chain.beaconEngine.verifiedBlocks.get(input.blockRootHex)?.blockBytes).toBe(blockBytes);
  });

  it("starts STF and signatures while the EL request is pending", async () => {
    const response = defer<Awaited<ReturnType<typeof chain.executionEngine.notifyNewPayload>>>();
    chain.executionEngine.notifyNewPayload.mockReturnValue(response.promise);
    const signatures = vi
      .spyOn(signatureVerification, "verifyBlocksSignatures")
      .mockResolvedValue({verifySignaturesTime: 0});
    const verification = chain.beaconEngine.verifyBlocks(serializeBlocks(bellatrixInput(true)), {}, signal);
    await vi.waitFor(() => expect(signatures).toHaveBeenCalledOnce());
    expect(stf.verifyBlocksStateTransitionOnly).toHaveBeenCalledOnce();
    expect(chain.beaconEngine.verifiedBlocks.size).toBe(0);
    response.resolve({
      status: ExecutionPayloadStatus.VALID,
      latestValidHash: toRootHex(Buffer.alloc(32, 1)),
      validationError: null,
    });
    await verification;
    expect(chain.beaconEngine.verifiedBlocks.size).toBe(1);
  });

  it("submits a segment sequentially and stops at the first invalid payload", async () => {
    const response = defer<Awaited<ReturnType<typeof chain.executionEngine.notifyNewPayload>>>();
    chain.executionEngine.notifyNewPayload.mockReturnValueOnce(response.promise);
    const verification = verifyBlocksExecutionPayload(
      chain,
      zeroProtoBlock,
      [bellatrixInput(true).getBlock(), bellatrixInput(true).getBlock()],
      state,
      new AbortController().signal,
      {}
    );
    expect(chain.executionEngine.notifyNewPayload).toHaveBeenCalledOnce();
    response.resolve({status: ExecutionPayloadStatus.INVALID, latestValidHash: null, validationError: "invalid"});
    expect(await verification).toMatchObject({execAborted: {blockIndex: 0}});
    expect(chain.executionEngine.notifyNewPayload).toHaveBeenCalledOnce();
  });

  it("leaves Gloas envelope submission to the facade", async () => {
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    const input = BlockInputNoData.createFromBlock({
      block,
      blockRootHex: toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message)),
      forkName: ForkName.gloas,
      daOutOfRange: false,
      source: BlockInputSource.gossip,
      seenTimestampSec: 0,
    });
    expect(await verifyBlockExecutionPayload(chain, input.getBlock(), state)).toMatchObject({
      executionStatus: ExecutionStatus.Syncing,
    });
    expect(chain.executionEngine.notifyNewPayload).not.toHaveBeenCalled();
  });

  it("skips the EL request when requested", async () => {
    await chain.beaconEngine.verifyBlocks(
      serializeBlocks(bellatrixInput()),
      {validSignatures: true, skipVerifyExecutionPayload: true},
      signal
    );
    expect(chain.executionEngine.notifyNewPayload).not.toHaveBeenCalled();
  });

  it("propagates invalid ancestry inside the engine and rejects without caching", async () => {
    const input = bellatrixInput(true);
    const latestValidHash = toRootHex(Buffer.alloc(32, 2));
    chain.executionEngine.notifyNewPayload.mockResolvedValue({
      status: ExecutionPayloadStatus.INVALID,
      latestValidHash,
      validationError: "invalid",
    });
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue({
      ...zeroProtoBlock,
      executionStatus: ExecutionStatus.Syncing,
      executionPayloadBlockHash: toRootHex(Buffer.alloc(32, 4)),
      executionPayloadNumber: 1,
      executionPayloadGasLimit: 30_000_000,
      dataAvailabilityStatus: DataAvailabilityStatus.Available,
    });
    await expect(
      chain.beaconEngine.verifyBlocks(serializeBlocks(input), {validSignatures: true}, signal)
    ).rejects.toMatchObject({type: {code: BlockErrorCode.EXECUTION_ENGINE_INVALID}});
    expect(chain.forkChoice.validateLatestHash).toHaveBeenCalledWith(
      expect.objectContaining({latestValidExecHash: latestValidHash})
    );
    expect(chain.beaconEngine.verifiedBlocks.size).toBe(0);
  });

  it("does not propagate invalid ancestry when consensus verification fails", async () => {
    const error = new Error("invalid consensus block");
    vi.mocked(stf.verifyBlocksStateTransitionOnly).mockRejectedValue(error);
    chain.executionEngine.notifyNewPayload.mockResolvedValue({
      status: ExecutionPayloadStatus.INVALID,
      latestValidHash: toRootHex(Buffer.alloc(32, 2)),
      validationError: "invalid payload",
    });
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue({
      ...zeroProtoBlock,
      executionStatus: ExecutionStatus.Syncing,
      executionPayloadBlockHash: toRootHex(Buffer.alloc(32, 4)),
      executionPayloadNumber: 1,
      executionPayloadGasLimit: 30_000_000,
      dataAvailabilityStatus: DataAvailabilityStatus.Available,
    });
    await expect(
      chain.beaconEngine.verifyBlocks(serializeBlocks(bellatrixInput(true)), {validSignatures: true}, signal)
    ).rejects.toBe(error);
    expect(chain.forkChoice.validateLatestHash).not.toHaveBeenCalled();
    expect(chain.beaconEngine.verifiedBlocks.size).toBe(0);
  });

  it("aborts the facade DA wait when the engine EL request rejects", async () => {
    const block = ssz.deneb.SignedBeaconBlock.defaultValue();
    block.message.body.executionPayload.blockHash = Buffer.alloc(32, 1);
    block.message.body.blobKzgCommitments = [Buffer.alloc(48, 2)];
    const input = BlockInputBlobs.createFromBlock({
      block,
      blockRootHex: toRootHex(ssz.deneb.BeaconBlock.hashTreeRoot(block.message)),
      forkName: ForkName.deneb,
      daOutOfRange: false,
      source: BlockInputSource.gossip,
      seenTimestampSec: 0,
    });
    const error = new Error("EL disconnected");
    chain.executionEngine.notifyNewPayload.mockRejectedValue(error);
    const waitingForData = vi.spyOn(input, "waitForAllData");
    await expect(verifyBlocksInEpoch.call(chain, zeroProtoBlock, [input], null, {validSignatures: true})).rejects.toBe(
      error
    );
    expect(waitingForData).toHaveBeenCalledOnce();
    expect(waitingForData.mock.calls[0][1]?.aborted).toBe(true);
    expect(chain.beaconEngine.verifiedBlocks.size).toBe(0);
  });

  it.each([false, true])("cleans up a DA failure after engine verification completes: %s", async (engineComplete) => {
    vi.spyOn(chain.config, "getForkName").mockReturnValue(ForkName.deneb);
    vi.spyOn(chain.config, "getForkTypes").mockReturnValue(
      createBeaconConfig(getConfig(ForkName.deneb), Buffer.alloc(32)).getForkTypes(0)
    );
    const block = ssz.deneb.SignedBeaconBlock.defaultValue();
    block.message.body.executionPayload.blockHash = Buffer.alloc(32, 1);
    block.message.body.blobKzgCommitments = [Buffer.alloc(48, 2)];
    const input = BlockInputBlobs.createFromBlock({
      block,
      blockRootHex: toRootHex(ssz.deneb.BeaconBlock.hashTreeRoot(block.message)),
      forkName: ForkName.deneb,
      daOutOfRange: false,
      source: BlockInputSource.gossip,
      seenTimestampSec: 0,
    });
    const data = defer<Awaited<ReturnType<typeof input.waitForAllData>>>();
    vi.spyOn(input, "waitForAllData").mockReturnValue(data.promise);
    const execution = defer<Awaited<ReturnType<typeof chain.executionEngine.notifyNewPayload>>>();
    if (!engineComplete) chain.executionEngine.notifyNewPayload.mockReturnValue(execution.promise);
    const error = new Error("DA unavailable");
    const verification = verifyBlocksInEpoch.call(chain, zeroProtoBlock, [input], null, {validSignatures: true});
    const rejected = expect(verification).rejects.toBe(error);
    await vi.waitFor(() => expect(chain.executionEngine.notifyNewPayload).toHaveBeenCalledOnce());
    const engineVerification = vi.mocked(chain.beaconEngine.verifyBlocks).mock.results[0].value;
    if (engineComplete) {
      await engineVerification;
      expect(chain.beaconEngine.verifiedBlocks.size).toBe(1);
    }
    data.reject(error);
    await rejected;
    if (!engineComplete) {
      const engineRejected = expect(engineVerification).rejects.toBeInstanceOf(ErrorAborted);
      execution.resolve({status: ExecutionPayloadStatus.SYNCING, latestValidHash: null, validationError: null});
      await engineRejected;
    }
    expect(chain.beaconEngine.verifiedBlocks.size).toBe(0);
  });
});
