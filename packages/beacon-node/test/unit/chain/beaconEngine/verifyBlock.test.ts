import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ExecutionStatus, PayloadStatus} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {BeaconStateView, DataAvailabilityStatus, signedBlockToSignedHeader} from "@lodestar/state-transition";
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
import {BeaconChain} from "../../../../src/chain/chain.js";
import {BlockError, BlockErrorCode} from "../../../../src/chain/errors/index.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/engine/interface.js";
import {kzgCommitmentToVersionedHash} from "../../../../src/util/blobs.js";
import {getMockedBeaconChain, withBeaconEngineFacade} from "../../../mocks/mockedBeaconChain.js";
import {generateCachedBellatrixState, zeroProtoBlock} from "../../../utils/state.js";

function bellatrixInput(enabled = false, slot = 0) {
  const block = ssz.bellatrix.SignedBeaconBlock.defaultValue();
  block.message.slot = slot;
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
  let core: BeaconEngineCore;
  let facade: BeaconChain;
  let state: BeaconStateView;

  beforeEach(() => {
    chain = getMockedBeaconChain({config: createBeaconConfig(getConfig(ForkName.bellatrix), Buffer.alloc(32))});
    core = chain.beaconEngine;
    facade = withBeaconEngineFacade(chain);
    const cachedState = generateCachedBellatrixState();
    cachedState.latestExecutionPayloadHeader = ssz.bellatrix.ExecutionPayloadHeader.toViewDU(
      ssz.bellatrix.ExecutionPayloadHeader.defaultValue()
    );
    state = new BeaconStateView(cachedState);
    Object.defineProperty(core, "verifiedBlocks", {value: new Map(), configurable: true});
    chain.forkChoice.validateLatestHash = vi.fn();
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(zeroProtoBlock);
    chain.regen.getPreState.mockResolvedValue(state);
    core.verifyBlocks = vi.fn(BeaconEngineCore.prototype.verifyBlocks.bind(core));
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
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each(["verifyBlocks", "validateApiBlock"] as const)(
    "%s records conflicting headers, but only normal processing schedules a slashing",
    async (method) => {
      vi.useFakeTimers();
      const processEquivocation = vi.fn();
      core.processProposerEquivocation = processEquivocation;
      vi.spyOn(signatureVerification, "verifyBlocksSignatures").mockResolvedValue({verifySignaturesTime: 0});
      const inputs = [bellatrixInput(), bellatrixInput(true)];

      for (const input of inputs) {
        const [data] = serializeBlocks(input);
        const result =
          method === "verifyBlocks"
            ? await core.verifyBlocks([data], {})
            : await core.validateApiBlock(data.blockRoot, data.blockBytes, {});
        expect(result.err, `verification failed for ${input.blockRootHex}`).toBeNull();
        expect(core.seenBlockProposers.hasBlockRoot(0, 0, input.blockRootHex), input.blockRootHex).toBe(true);
      }

      expect(core.seenBlockProposers.getEquivocationHeaders(0, 0)).toEqual(
        inputs.map((input) => signedBlockToSignedHeader(core.config, input.getBlock()))
      );
      expect(core.seenBlockProposers.isKnown(0, 0)).toBe(false);
      expect(processEquivocation).not.toHaveBeenCalled();
      await vi.runOnlyPendingTimersAsync();
      expect(processEquivocation).toHaveBeenCalledTimes(method === "verifyBlocks" ? 1 : 0);
      if (method === "verifyBlocks") expect(processEquivocation).toHaveBeenCalledWith(0, 0);
      else expect(core.verifiedBlocks.size).toBe(0);
    }
  );

  it("does not record a header when signature verification fails", async () => {
    const input = bellatrixInput();
    const error = new BlockError(input.getBlock(), {code: BlockErrorCode.INVALID_SIGNATURE, stateSlot: 0});
    vi.spyOn(signatureVerification, "verifyBlocksSignatures").mockRejectedValue(error);

    await expect(core.verifyBlocks(serializeBlocks(input), {})).resolves.toMatchObject({
      err: {type: {code: BlockErrorCode.INVALID_SIGNATURE}},
    });
    expect(core.seenBlockProposers.hasBlockRoot(0, 0, input.blockRootHex)).toBe(false);
    expect(core.verifiedBlocks.size).toBe(0);
  });

  it("records every header in a verified batch before import", async () => {
    const inputs = [bellatrixInput(false, 1), bellatrixInput(false, 2)];
    vi.mocked(stf.verifyBlocksStateTransitionOnly).mockResolvedValue({
      postStates: [state, state],
      proposerBalanceDeltas: [0, 0],
      verifyStateTime: 0,
    });

    await expect(core.verifyBlocks(serializeBlocks(...inputs), {validSignatures: true})).resolves.toMatchObject({
      err: null,
    });

    for (const input of inputs) {
      expect(
        core.seenBlockProposers.hasBlockRoot(input.getBlock().message.slot, 0, input.blockRootHex),
        `missing header for ${input.blockRootHex}`
      ).toBe(true);
    }
  });

  it.each([false, true])("resolves block bytes with an existing decoded entry: %s", async (cached) => {
    const input = bellatrixInput();
    const block = input.getBlock();
    const [{blockRoot, blockBytes: bytes}] = serializeBlocks(input);
    if (cached) chain.blockSerializedCache.set(input.blockRootHex, block, bytes);
    const deserialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "deserialize");
    const opts = structuredClone({validSignatures: true});
    await core.verifyBlocks([{blockRoot, blockBytes: bytes}], opts);
    const verifiedBlock = core.verifiedBlocks.get(input.blockRootHex)?.block;
    expect(verifiedBlock).toEqual(block);
    if (cached) {
      expect(verifiedBlock).toBe(block);
      expect(deserialize).not.toHaveBeenCalled();
    } else {
      expect(verifiedBlock).not.toBe(block);
      expect(verifiedBlock?.signature.buffer).not.toBe(bytes.buffer);
      expect(deserialize).toHaveBeenCalledExactlyOnceWith(bytes, {reuseBytes: false});
    }
    await core.verifyBlocks([{blockRoot, blockBytes: Uint8Array.from(bytes)}], opts);
    expect(deserialize).toHaveBeenCalledTimes(cached ? 0 : 1);
    expect(core.verifiedBlocks.get(input.blockRootHex)?.block).toBe(verifiedBlock);
    expect(core.verifiedBlocks.get(input.blockRootHex)?.blockBytes).toBe(bytes);
  });

  it("stops further EL submissions when engine state transition fails", async () => {
    const execution = defer<Awaited<ReturnType<typeof chain.executionEngine.notifyNewPayload>>>();
    chain.executionEngine.notifyNewPayload.mockReturnValueOnce(execution.promise);
    const payloads = vi.spyOn(executionVerification, "verifyBlocksExecutionPayload");
    const error = new Error("invalid consensus block");
    vi.mocked(stf.verifyBlocksStateTransitionOnly).mockRejectedValueOnce(error);

    await expect(
      core.verifyBlocks(serializeBlocks(bellatrixInput(true), bellatrixInput(true)), {
        validSignatures: true,
      })
    ).rejects.toBe(error);

    const rejected = expect(payloads.mock.results[0].value).rejects.toBeInstanceOf(ErrorAborted);
    execution.resolve({status: ExecutionPayloadStatus.SYNCING, latestValidHash: null, validationError: null});
    await rejected;
    expect(chain.executionEngine.notifyNewPayload).toHaveBeenCalledOnce();
    expect(core.verifiedBlocks.size).toBe(0);
  });

  it("validates an API block without retaining an import bundle or submitting its payload to the EL", async () => {
    const [{blockRoot, blockBytes}] = serializeBlocks(bellatrixInput(true));
    await core.validateApiBlock(blockRoot, blockBytes, {validSignatures: true});
    expect(stf.verifyBlocksStateTransitionOnly).toHaveBeenCalledOnce();
    expect(chain.executionEngine.notifyNewPayload).not.toHaveBeenCalled();
    expect(core.verifiedBlocks.size).toBe(0);
  });

  it.each([false, true])("preserves a pending import bundle during API validation (failure: %s)", async (failure) => {
    const [data] = serializeBlocks(bellatrixInput());
    await core.verifyBlocks([data], {validSignatures: true});
    const pending = core.verifiedBlocks.get(toRootHex(data.blockRoot));
    const error = new Error("API state transition failed");
    if (failure) vi.mocked(stf.verifyBlocksStateTransitionOnly).mockRejectedValueOnce(error);

    const validating = core.validateApiBlock(data.blockRoot, data.blockBytes, {validSignatures: true});
    if (failure) await expect(validating).rejects.toBe(error);
    else await validating;

    expect(core.verifiedBlocks.get(toRootHex(data.blockRoot))).toBe(pending);
  });

  it("rejects malformed block bytes before regenerating state", async () => {
    await expect(
      core.verifyBlocks([{blockRoot: new Uint8Array(32), blockBytes: new Uint8Array()}], {})
    ).rejects.toMatchObject({
      type: {code: "INVALID_BLOCK_SSZ"},
    });
    expect(chain.regen.getPreState).not.toHaveBeenCalled();
  });

  it("registers serialization fallback bytes so facade verification reuses the original block", async () => {
    const input = bellatrixInput();
    const block = input.getBlock();
    const deserialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "deserialize");
    await verifyBlocksInEpoch.call(facade, zeroProtoBlock, [input], null, {validSignatures: true});
    expect(deserialize).not.toHaveBeenCalled();
    expect(core.verifiedBlocks.get(input.blockRootHex)?.block).toBe(block);
    expect(core.verifiedBlocks.get(input.blockRootHex)?.blockBytes).toBe(
      chain.blockSerializedCache.get(input.blockRootHex)?.bytes
    );
  });

  it("rehydrates a cloned engine failure with the second local block", async () => {
    const inputs = [bellatrixInput(false, 1), bellatrixInput(false, 2)];
    const cause = new Error("state transition failed");
    vi.mocked(stf.verifyBlocksStateTransitionOnly).mockImplementation(async (_config, _state, blocks) => {
      throw new BlockError(blocks[1], {
        code: BlockErrorCode.PER_BLOCK_PROCESSING_ERROR,
        blockRoot: inputs[1].blockRootHex,
        error: cause,
      });
    });
    const verify = core.verifyBlocks;
    core.verifyBlocks = vi.fn(async (...args: Parameters<typeof verify>) => structuredClone(await verify(...args)));
    const observe = vi.spyOn(core.seenBlockProposers, "observeBlockRoot");
    const discard = vi.spyOn(core, "discardVerifiedBlocks");
    const verification = verifyBlocksInEpoch.call(facade, zeroProtoBlock, inputs, null, {validSignatures: true});
    await expect(verification).rejects.toBeInstanceOf(BlockError);
    await expect(verification).rejects.toMatchObject({
      signedBlock: inputs[1].getBlock(),
      type: {code: BlockErrorCode.PER_BLOCK_PROCESSING_ERROR, blockRoot: inputs[1].blockRootHex},
    });
    await verification.catch((error: BlockError) => {
      expect(error.signedBlock).toBe(inputs[1].getBlock());
      expect(error.type).toHaveProperty("error.message", cause.message);
    });
    expect(core.verifyBlocks).toHaveBeenCalledExactlyOnceWith(serializeBlocks(...inputs), {validSignatures: true});
    expect(chain.publishChainView).toHaveBeenCalledOnce();
    expect(observe).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledExactlyOnceWith(inputs.map((input) => input.blockRootHex));
  });

  it.each(["verifyBlocks", "validateApiBlock"] as const)(
    "%s returns a missing parent failure before regenerating state",
    async (method) => {
      chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(null);
      const [data] = serializeBlocks(bellatrixInput());
      const result =
        method === "verifyBlocks"
          ? core.verifyBlocks([data], {})
          : core.validateApiBlock(data.blockRoot, data.blockBytes, {});
      await expect(result).resolves.toMatchObject({
        err: {blockIndex: 0, blockRoot: toRootHex(data.blockRoot), type: {code: BlockErrorCode.PARENT_BLOCK_UNKNOWN}},
      });
      expect(chain.regen.getPreState).not.toHaveBeenCalled();
    }
  );

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
      await verifyEngineBlocks.call(core, serializeBlocks(input), {validSignatures: true});
      expect(chain.forkChoice.getBlockHexAndBlockHash).toHaveBeenCalledWith(
        toRootHex(block.message.parentRoot),
        toRootHex(block.message.body.signedExecutionPayloadBid.message.parentBlockHash)
      );
      expect(execution.mock.calls[0][1]).toBe(variant ?? pending);
    }
  );

  it("does not submit an empty pre-merge Bellatrix payload", async () => {
    expect(await verifyBlockExecutionPayload(core, bellatrixInput().getBlock(), state)).toMatchObject({
      executionStatus: ExecutionStatus.PreMerge,
    });
    expect(chain.executionEngine.notifyNewPayload).not.toHaveBeenCalled();
  });

  it("submits the transition payload when execution becomes enabled", async () => {
    const input = bellatrixInput(true);
    expect(await verifyBlockExecutionPayload(core, input.getBlock(), state)).toMatchObject({
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
    await verifyBlockExecutionPayload(core, input.getBlock(), state);
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
    const result = await core.verifyBlocks([{blockRoot: fromHex(input.blockRootHex), blockBytes}], {
      validSignatures: true,
    });
    expect(result).toMatchObject({err: null, result: {segmentExecStatus: {executionStatuses: [expected]}}});
    expect(core.verifiedBlocks.get(input.blockRootHex)?.executionStatus).toBe(expected);
    expect(core.verifiedBlocks.get(input.blockRootHex)?.blockBytes).toBe(blockBytes);
  });

  it("starts STF and signatures while the EL request is pending", async () => {
    const response = defer<Awaited<ReturnType<typeof chain.executionEngine.notifyNewPayload>>>();
    chain.executionEngine.notifyNewPayload.mockReturnValue(response.promise);
    const signatures = vi
      .spyOn(signatureVerification, "verifyBlocksSignatures")
      .mockResolvedValue({verifySignaturesTime: 0});
    const verification = core.verifyBlocks(serializeBlocks(bellatrixInput(true)), {});
    await vi.waitFor(() => expect(signatures).toHaveBeenCalledOnce());
    expect(stf.verifyBlocksStateTransitionOnly).toHaveBeenCalledOnce();
    expect(core.verifiedBlocks.size).toBe(0);
    response.resolve({
      status: ExecutionPayloadStatus.VALID,
      latestValidHash: toRootHex(Buffer.alloc(32, 1)),
      validationError: null,
    });
    await verification;
    expect(core.verifiedBlocks.size).toBe(1);
  });

  it("submits a segment sequentially and stops at the first invalid payload", async () => {
    const response = defer<Awaited<ReturnType<typeof chain.executionEngine.notifyNewPayload>>>();
    chain.executionEngine.notifyNewPayload.mockReturnValueOnce(response.promise);
    const verification = verifyBlocksExecutionPayload(
      core,
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
    expect(await verifyBlockExecutionPayload(core, input.getBlock(), state)).toMatchObject({
      executionStatus: ExecutionStatus.Syncing,
    });
    expect(chain.executionEngine.notifyNewPayload).not.toHaveBeenCalled();
  });

  it("skips the EL request when requested", async () => {
    await core.verifyBlocks(serializeBlocks(bellatrixInput()), {
      validSignatures: true,
      skipVerifyExecutionPayload: true,
    });
    expect(chain.executionEngine.notifyNewPayload).not.toHaveBeenCalled();
  });

  it("propagates invalid ancestry inside the engine and rejects without caching", async () => {
    vi.useFakeTimers();
    const processEquivocation = vi.fn();
    core.processProposerEquivocation = processEquivocation;
    const sibling = bellatrixInput();
    core.seenBlockProposers.observeBlockRoot(
      0,
      0,
      sibling.blockRootHex,
      signedBlockToSignedHeader(core.config, sibling.getBlock())
    );
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
    await expect(core.verifyBlocks(serializeBlocks(input), {validSignatures: true})).resolves.toMatchObject({
      err: {type: {code: BlockErrorCode.EXECUTION_ENGINE_INVALID}},
    });
    expect(chain.forkChoice.validateLatestHash).toHaveBeenCalledWith(
      expect.objectContaining({latestValidExecHash: latestValidHash})
    );
    expect(core.seenBlockProposers.hasBlockRoot(0, 0, input.blockRootHex)).toBe(true);
    expect(core.seenBlockProposers.isKnown(0, 0)).toBe(false);
    expect(core.verifiedBlocks.size).toBe(0);
    await vi.runOnlyPendingTimersAsync();
    expect(processEquivocation).toHaveBeenCalledExactlyOnceWith(0, 0);
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
    await expect(core.verifyBlocks(serializeBlocks(bellatrixInput(true)), {validSignatures: true})).rejects.toBe(error);
    expect(chain.forkChoice.validateLatestHash).not.toHaveBeenCalled();
    expect(core.verifiedBlocks.size).toBe(0);
  });

  it.each([false, true])("aborts the facade DA wait on an EL failure (typed: %s)", async (typed) => {
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
    const error = typed
      ? new BlockError(block, {
          code: BlockErrorCode.EXECUTION_ENGINE_ERROR,
          execStatus: ExecutionPayloadStatus.UNAVAILABLE,
          errorMessage: "EL disconnected",
        })
      : new Error("EL disconnected");
    chain.executionEngine.notifyNewPayload.mockRejectedValue(error);
    const waitingForData = vi.spyOn(input, "waitForAllData");
    const verification = verifyBlocksInEpoch.call(facade, zeroProtoBlock, [input], null, {validSignatures: true});
    if (typed) {
      await expect(verification).rejects.toBeInstanceOf(BlockError);
      await expect(verification).rejects.toMatchObject(error);
    } else {
      await expect(verification).rejects.toBe(error);
    }
    expect(waitingForData).toHaveBeenCalledOnce();
    expect(waitingForData.mock.calls[0][1]?.aborted).toBe(true);
    expect(core.verifiedBlocks.size).toBe(0);
  });

  it.each(["complete", "pending", "rejecting", "regenerating"] as const)(
    "cleans up DA failure with engine verification %s",
    async (engineStatus) => {
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
      const waitingForData = vi.spyOn(input, "waitForAllData").mockReturnValue(data.promise);
      const execution = defer<Awaited<ReturnType<typeof chain.executionEngine.notifyNewPayload>>>();
      if (engineStatus === "pending" || engineStatus === "rejecting") {
        chain.executionEngine.notifyNewPayload.mockReturnValue(execution.promise);
      }
      const preState = defer<BeaconStateView>();
      if (engineStatus === "regenerating") chain.regen.getPreState.mockReturnValue(preState.promise);
      const discard = vi.spyOn(core, "discardVerifiedBlocks");
      const error = new Error("DA unavailable");
      const verification = verifyBlocksInEpoch.call(facade, zeroProtoBlock, [input], null, {validSignatures: true});
      const rejected = expect(verification).rejects.toBe(error);
      await vi.waitFor(() => expect(chain.regen.getPreState).toHaveBeenCalledOnce());
      const engineVerification = vi.mocked(core.verifyBlocks).mock.results[0].value;
      if (engineStatus === "complete") {
        await engineVerification;
        expect(core.verifiedBlocks.size).toBe(1);
        expect(core.seenBlockProposers.hasBlockRoot(0, 0, input.blockRootHex)).toBe(true);
      }
      data.reject(error);
      await vi.waitFor(() => expect(waitingForData.mock.calls[0][1]?.aborted).toBe(true));
      if (engineStatus !== "complete") expect(discard).not.toHaveBeenCalled();
      if (engineStatus === "pending") {
        execution.resolve({status: ExecutionPayloadStatus.SYNCING, latestValidHash: null, validationError: null});
      } else if (engineStatus === "rejecting") {
        execution.reject(new Error("EL disconnected"));
      } else if (engineStatus === "regenerating") {
        preState.resolve(state);
      }
      await rejected;
      expect(discard).toHaveBeenCalledExactlyOnceWith([input.blockRootHex]);
      expect(core.seenBlockProposers.hasBlockRoot(0, 0, input.blockRootHex)).toBe(engineStatus !== "rejecting");
      expect(core.seenBlockProposers.isKnown(0, 0)).toBe(false);
      expect(core.verifiedBlocks.size).toBe(0);
    }
  );
});
