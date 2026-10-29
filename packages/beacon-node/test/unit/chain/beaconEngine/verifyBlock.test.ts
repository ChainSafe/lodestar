import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ExecutionStatus, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {BeaconStateView, DataAvailabilityStatus, signedBlockToSignedHeader} from "@lodestar/state-transition";
import {bellatrix, ssz, sszTypesFor} from "@lodestar/types";
import {ErrorAborted, defer, fromHex, toRootHex} from "@lodestar/utils";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineMode} from "../../../../src/chain/beaconEngine/options.js";
import {verifyBlocksBytes as verifyEngineBlocks} from "../../../../src/chain/beaconEngine/verifyBlock.js";
import {
  BlockInputBlobs,
  BlockInputNoData,
  BlockInputPreData,
} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource, IBlockInput} from "../../../../src/chain/blocks/blockInput/index.js";
import {BlockBytes, BlockSerializedCache} from "../../../../src/chain/blocks/blockSerializedCache.js";
import {computeSignedBlockRoot, toSignedBlockRootHex} from "../../../../src/chain/blocks/signedBlockRoot.js";
import {verifyBlocksInEpoch} from "../../../../src/chain/blocks/verifyBlock.js";
import * as executionVerification from "../../../../src/chain/blocks/verifyBlocksExecutionPayloads.js";
import {
  verifyBlockExecutionPayload,
  verifyBlocksExecutionPayload,
} from "../../../../src/chain/blocks/verifyBlocksExecutionPayloads.js";
import * as signatureVerification from "../../../../src/chain/blocks/verifyBlocksSignatures.js";
import * as stf from "../../../../src/chain/blocks/verifyBlocksStateTransitionOnly.js";
import {BeaconChain} from "../../../../src/chain/chain.js";
import {ChainEvent} from "../../../../src/chain/emitter.js";
import {BlockError, BlockErrorCode, BlockGossipError, GossipAction} from "../../../../src/chain/errors/index.js";
import * as blockValidation from "../../../../src/chain/validation/block.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/engine/interface.js";
import {kzgCommitmentToVersionedHash} from "../../../../src/util/blobs.js";
import {getMockedBeaconChain, withBeaconEngineFacade} from "../../../mocks/mockedBeaconChain.js";
import {generateCachedBellatrixState, zeroProtoBlock} from "../../../utils/state.js";

const engineModes = [BeaconEngineMode.MainThread, BeaconEngineMode.Worker];

function bellatrixInput(enabled = false, slot = 0, source = BlockInputSource.gossip) {
  const block = ssz.bellatrix.SignedBeaconBlock.defaultValue();
  block.message.slot = slot;
  if (enabled) block.message.body.executionPayload.blockHash = Buffer.alloc(32, 1);
  return BlockInputPreData.createFromBlock({
    block,
    blockRootHex: toRootHex(ssz.bellatrix.BeaconBlock.hashTreeRoot(block.message)),
    forkName: ForkName.bellatrix,
    daOutOfRange: false,
    source,
    seenTimestampSec: 0,
  });
}

function signedRoot(input: IBlockInput) {
  return toSignedBlockRootHex(computeSignedBlockRoot(input.forkName, input.getBlock()));
}

function serializeBlocks(...inputs: IBlockInput[]): BlockBytes[] {
  return inputs.map((input) => ({
    signedBlockRoot: computeSignedBlockRoot(input.forkName, input.getBlock()),
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
    core.verifyBlocksBytes = vi.fn(BeaconEngineCore.prototype.verifyBlocksBytes.bind(core));
    core.verifyBlocks = vi.fn(BeaconEngineCore.prototype.verifyBlocks.bind(core));
    core.verifyGossipBlockBytes = vi.fn(BeaconEngineCore.prototype.verifyGossipBlockBytes.bind(core));
    core.verifyGossipBlock = vi.fn(BeaconEngineCore.prototype.verifyGossipBlock.bind(core));
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

  it.each([
    {opts: {}, expected: 12.75},
    {opts: {seenTimestampSec: 3.5}, expected: 3.5},
  ])("preserves the fractional seen timestamp $expected", async ({opts, expected}) => {
    vi.spyOn(Date, "now").mockReturnValue(12_750);
    const input = bellatrixInput();
    await verifyEngineBlocks.call(core, serializeBlocks(input), {...opts, validSignatures: true});
    expect(core.verifiedBlocks.get(signedRoot(input))?.seenTimestampSec).toBe(expected);
  });

  it.each(["verifyBlocksBytes", "validateApiBlockBytes"] as const)(
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
          method === "verifyBlocksBytes"
            ? await core.verifyBlocksBytes([data], {})
            : await core.validateApiBlockBytes(data.signedBlockRoot, data.blockBytes, {});
        expect(result.err, `verification failed for ${input.blockRootHex}`).toBeNull();
        expect(core.seenBlockProposers.hasBlockRoot(0, 0, input.blockRootHex), input.blockRootHex).toBe(true);
        expect(core.blockSerializedCache.get(signedRoot(input)) !== undefined, input.blockRootHex).toBe(
          method === "verifyBlocksBytes"
        );
      }

      expect(core.seenBlockProposers.getEquivocationHeaders(0, 0)).toEqual(
        inputs.map((input) => signedBlockToSignedHeader(core.config, input.getBlock()))
      );
      expect(core.seenBlockProposers.isKnown(0, 0)).toBe(method === "verifyBlocksBytes");
      expect(processEquivocation).not.toHaveBeenCalled();
      await vi.runOnlyPendingTimersAsync();
      expect(processEquivocation).toHaveBeenCalledTimes(method === "verifyBlocksBytes" ? 1 : 0);
      if (method === "verifyBlocksBytes") expect(processEquivocation).toHaveBeenCalledWith(0, 0);
      else expect(core.verifiedBlocks.size).toBe(0);
    }
  );

  it("does not record a header when signature verification fails", async () => {
    const input = bellatrixInput();
    const error = new BlockError(input.getBlock(), {code: BlockErrorCode.INVALID_SIGNATURE, stateSlot: 0});
    vi.spyOn(signatureVerification, "verifyBlocksSignatures").mockRejectedValue(error);

    await expect(core.verifyBlocksBytes(serializeBlocks(input), {})).resolves.toMatchObject({
      err: {type: {code: BlockErrorCode.INVALID_SIGNATURE}},
    });
    expect(core.seenBlockProposers.hasBlockRoot(0, 0, input.blockRootHex)).toBe(false);
    expect(core.seenBlockProposers.isKnown(0, 0)).toBe(false);
    expect(core.verifiedBlocks.size).toBe(0);
  });

  it("records every header and marks every proposal in a verified batch before import", async () => {
    const inputs = [bellatrixInput(false, 1), bellatrixInput(false, 2)];
    vi.mocked(stf.verifyBlocksStateTransitionOnly).mockResolvedValue({
      postStates: [state, state],
      proposerBalanceDeltas: [0, 0],
      verifyStateTime: 0,
    });

    await expect(core.verifyBlocksBytes(serializeBlocks(...inputs), {validSignatures: true})).resolves.toMatchObject({
      err: null,
    });

    for (const input of inputs) {
      expect(
        core.seenBlockProposers.hasBlockRoot(input.getBlock().message.slot, 0, input.blockRootHex),
        `missing header for ${input.blockRootHex}`
      ).toBe(true);
      expect(
        core.seenBlockProposers.isKnown(input.getBlock().message.slot, 0),
        `unknown proposal for ${input.blockRootHex}`
      ).toBe(true);
    }
  });

  it.each([false, true])("resolves block bytes with an existing decoded entry: %s", async (cached) => {
    const input = bellatrixInput();
    const block = input.getBlock();
    const [{signedBlockRoot, blockBytes: bytes}] = serializeBlocks(input);
    if (cached) chain.beaconEngine.blockSerializedCache.set(signedRoot(input), block, bytes);
    const deserialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "deserialize");
    const opts = structuredClone({validSignatures: true});
    await core.verifyBlocksBytes([{signedBlockRoot, blockBytes: bytes}], opts);
    const verifiedBlock = core.verifiedBlocks.get(signedRoot(input))?.block;
    if (verifiedBlock === undefined) throw Error("Expected a retained verification block");
    expect(core.config.getForkTypes(block.message.slot).SignedBeaconBlock.equals(verifiedBlock, block)).toBe(true);
    if (cached) {
      expect(verifiedBlock).toBe(block);
    } else {
      expect(verifiedBlock).not.toBe(block);
      expect(verifiedBlock?.signature.buffer).not.toBe(bytes.buffer);
    }
    if (cached) expect(deserialize).not.toHaveBeenCalled();
    else expect(deserialize).toHaveBeenCalledExactlyOnceWith(bytes, {reuseBytes: false});
    await core.verifyBlocksBytes([{signedBlockRoot, blockBytes: Uint8Array.from(bytes)}], opts);
    expect(deserialize).toHaveBeenCalledTimes(cached ? 0 : 1);
    expect(core.verifiedBlocks.get(signedRoot(input))?.block).toBe(verifiedBlock);
    expect(core.verifiedBlocks.get(signedRoot(input))?.blockBytes).toBe(bytes);
  });

  it("retains and discards verification bundles by signed candidate for the same message root", async () => {
    const first = bellatrixInput();
    const other = bellatrixInput();
    const otherBlock = other.getBlock();
    otherBlock.signature = Uint8Array.from(otherBlock.signature);
    otherBlock.signature[0] = 1;
    expect(other.blockRootHex).toBe(first.blockRootHex);
    await expect(core.verifyBlocksBytes(serializeBlocks(first), {validSignatures: true})).resolves.toMatchObject({
      err: null,
    });
    const firstBundle = core.verifiedBlocks.get(signedRoot(first));
    expect(firstBundle).toBeDefined();
    await expect(core.verifyBlocksBytes(serializeBlocks(other), {validSignatures: true})).resolves.toMatchObject({
      err: null,
    });

    expect(core.verifiedBlocks.size).toBe(2);
    expect(core.verifiedBlocks.get(signedRoot(first))).toBe(firstBundle);
    expect(core.verifiedBlocks.get(signedRoot(other))?.block.signature).toEqual(otherBlock.signature);
    await core.discardVerifiedBlocks([computeSignedBlockRoot(other.forkName, other.getBlock())]);
    expect(core.verifiedBlocks.get(signedRoot(other))).toBeUndefined();
    expect(core.verifiedBlocks.get(signedRoot(first))).toBe(firstBundle);
  });

  it("retains object verification bundles in Core without serialization or candidate-cache access", async () => {
    const first = bellatrixInput();
    const second = bellatrixInput();
    second.getBlock().signature = Buffer.alloc(96, 1);
    const inputs = [first, second];
    const entries = inputs.map((input) => ({data: input.getBlock(), bytes: serializeBlocks(input)[0].blockBytes}));
    Object.defineProperty(core, "blockSerializedCache", {
      get: () => {
        throw Error("Object verification must not access the candidate cache");
      },
    });
    const serialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "serialize");
    const deserialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "deserialize");

    for (const [i, entry] of entries.entries()) {
      const result = await core.verifyBlocks([entry], {validSignatures: true});
      expect(result.err, `candidate ${i}`).toBeNull();
      if (result.err !== null) throw result.err;
      expect(result.result, `candidate ${i} result`).not.toHaveProperty("verifiedBlocks");
      expect(structuredClone(result), `candidate ${i} metadata`).toEqual(result);
      const bundle = core.verifiedBlocks.get(signedRoot(inputs[i]));
      expect(bundle?.block, `candidate ${i} block`).toBe(entry.data);
      expect(bundle?.blockBytes, `candidate ${i} bytes`).toBe(entry.bytes);
      expect(bundle?.postState, `candidate ${i} state`).toBe(state);
    }
    expect(core.verifiedBlocks.size).toBe(2);
    expect(serialize).not.toHaveBeenCalled();
    expect(deserialize).not.toHaveBeenCalled();
  });

  it("keeps a pending import bundle intact during object API verification", async () => {
    const input = bellatrixInput(true);
    const block = input.getBlock();
    const bytes = serializeBlocks(input)[0].blockBytes;
    await core.verifyBlocksBytes(
      [{signedBlockRoot: computeSignedBlockRoot(input.forkName, block), blockBytes: bytes}],
      {
        validSignatures: true,
      }
    );
    const pending = core.verifiedBlocks.get(signedRoot(input));
    const retained = core.verifiedBlocks;
    Object.defineProperty(core, "verifiedBlocks", {
      get: () => {
        throw Error("Object API validation must not access the verified-block cache");
      },
    });
    const candidateCache = core.blockSerializedCache;
    const cached = candidateCache.get(signedRoot(input));
    chain.executionEngine.notifyNewPayload.mockClear();
    Object.defineProperty(core, "blockSerializedCache", {
      get: () => {
        throw Error("Object API validation must not access the candidate cache");
      },
    });
    const deserialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "deserialize");

    expect(
      await BeaconEngineCore.prototype.validateApiBlock.call(core, {data: block, bytes}, {validSignatures: true})
    ).toEqual({err: null, result: undefined});
    expect(retained.get(signedRoot(input))).toBe(pending);
    expect(candidateCache.get(signedRoot(input))).toBe(cached);
    expect(vi.mocked(stf.verifyBlocksStateTransitionOnly).mock.lastCall?.[2][0]).toBe(block);
    expect(chain.executionEngine.notifyNewPayload).not.toHaveBeenCalled();
    expect(deserialize).not.toHaveBeenCalled();
  });

  it("retains a verified gossip object without serialization or candidate-cache access", async () => {
    const input = bellatrixInput();
    const block = input.getBlock();
    const bytes = serializeBlocks(input)[0].blockBytes;
    Object.defineProperty(core, "serializedCache", {
      get: () => {
        throw Error("Object APIs must not access SerializedCache");
      },
    });
    Object.defineProperty(core, "blockSerializedCache", {
      get: () => {
        throw Error("Object APIs must not access the candidate cache");
      },
    });
    const serialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "serialize");
    const deserialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "deserialize");
    vi.spyOn(blockValidation, "validateGossipBlock").mockResolvedValue({skippedSlots: 0});

    expect(
      await BeaconEngineCore.prototype.validateGossipBlock.call(core, {data: block, bytes}, input.forkName, 0)
    ).toMatchObject({err: null});
    const result = await core.verifyGossipBlock({data: block, bytes}, {validSignatures: true});
    expect(result).toMatchObject({err: null});
    if (result.err !== null) throw result.err;
    expect(result.result).not.toHaveProperty("verifiedBlocks");
    expect(core.verifiedBlocks.get(signedRoot(input))?.block).toBe(block);
    expect(core.verifiedBlocks.get(signedRoot(input))?.blockBytes).toBe(bytes);
    expect(serialize).not.toHaveBeenCalled();
    expect(deserialize).not.toHaveBeenCalled();
  });

  it("returns the same indexed block failure for object and byte batches", async () => {
    const inputs = [bellatrixInput(false, 0), bellatrixInput(false, 1)];
    const data = serializeBlocks(...inputs);
    const entries = inputs.map((input, i) => ({data: input.getBlock(), bytes: data[i].blockBytes}));
    const error = new BlockError(inputs[1].getBlock(), {code: BlockErrorCode.INVALID_SIGNATURE, stateSlot: 0});
    vi.mocked(stf.verifyBlocksStateTransitionOnly).mockRejectedValue(error);
    const expected = await core.verifyBlocksBytes(data, {validSignatures: true});
    const deserialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "deserialize");

    const result = await BeaconEngineCore.prototype.verifyBlocks.call(core, entries, {validSignatures: true});
    expect(result).toEqual(expected);
    expect(result).toMatchObject({err: {blockIndex: 1, blockRoot: inputs[1].blockRootHex, type: error.type}});
    expect(core.verifiedBlocks.size).toBe(0);
    expect(deserialize).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "handles gossip object validation errors without candidate-cache access (unexpected: %s)",
    async (unexpected) => {
      const input = bellatrixInput();
      const block = input.getBlock();
      const bytes = serializeBlocks(input)[0].blockBytes;
      const error = new BlockGossipError(GossipAction.REJECT, {
        code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID,
        slot: block.message.slot,
        root: input.blockRootHex,
      });
      vi.spyOn(blockValidation, "validateGossipBlock").mockRejectedValue(
        unexpected ? new Error("validation failed") : error
      );
      const candidateCacheAccess = vi.fn(() => {
        throw Error("Object validation must not access the candidate cache");
      });
      Object.defineProperty(core, "blockSerializedCache", {
        get: candidateCacheAccess,
      });

      const result = await BeaconEngineCore.prototype.validateGossipBlock.call(
        core,
        {data: block, bytes},
        input.forkName,
        0
      );
      expect(result).toMatchObject(
        unexpected
          ? {
              err: {status: "ignore", code: "UNEXPECTED_ERROR"},
              shouldProcessRepeatProposalBlock: false,
            }
          : {
              err: {status: "reject", code: error.type.code},
              blockErrorType: error.type,
              shouldProcessRepeatProposalBlock: false,
            }
      );
      expect(candidateCacheAccess).not.toHaveBeenCalled();
      expect(core.verifiedBlocks.size).toBe(0);
    }
  );

  it("stops further EL submissions when engine state transition fails", async () => {
    const execution = defer<Awaited<ReturnType<typeof chain.executionEngine.notifyNewPayload>>>();
    chain.executionEngine.notifyNewPayload.mockReturnValueOnce(execution.promise);
    const payloads = vi.spyOn(executionVerification, "verifyBlocksExecutionPayload");
    const error = new Error("invalid consensus block");
    vi.mocked(stf.verifyBlocksStateTransitionOnly).mockRejectedValueOnce(error);

    await expect(
      core.verifyBlocksBytes(serializeBlocks(bellatrixInput(true), bellatrixInput(true)), {
        validSignatures: true,
      })
    ).rejects.toBe(error);

    const rejected = expect(payloads.mock.results[0].value).rejects.toBeInstanceOf(ErrorAborted);
    execution.resolve({status: ExecutionPayloadStatus.SYNCING, latestValidHash: null, validationError: null});
    await rejected;
    expect(chain.executionEngine.notifyNewPayload).toHaveBeenCalledOnce();
    expect(core.verifiedBlocks.size).toBe(0);
  });

  it.each(engineModes.flatMap((beaconEngineMode) => [false, true].map((cached) => ({beaconEngineMode, cached}))))(
    "validates API blocks without retaining a bundle or submitting to the EL (worker: $beaconEngineMode, cached: $cached)",
    async ({beaconEngineMode, cached}) => {
      chain.opts.beaconEngineMode = beaconEngineMode;
      facade = withBeaconEngineFacade(chain);
      const serializedCache = chain.serializedCache;
      const input = bellatrixInput(true);
      const block = input.getBlock();
      const bytes = sszTypesFor(input.forkName).SignedBeaconBlock.serialize(block);
      if (cached) serializedCache.set(block, bytes);
      const serialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "serialize");
      const deserialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "deserialize");
      const validateBytes = vi.spyOn(core, "validateApiBlockBytes");
      const validateObject = vi.spyOn(core, "validateApiBlock");

      await facade.beaconEngine.validateApiBlock(input, {validSignatures: true});

      expect(serialize).toHaveBeenCalledTimes(cached ? 0 : 1);
      expect(deserialize).toHaveBeenCalledTimes(beaconEngineMode !== BeaconEngineMode.MainThread ? 1 : 0);
      const cachedBytes = serializedCache.get(block);
      expect(cachedBytes).toEqual(bytes);
      if (cached) expect(cachedBytes).toBe(bytes);
      if (beaconEngineMode !== BeaconEngineMode.MainThread) {
        expect(validateBytes).toHaveBeenCalledExactlyOnceWith(
          computeSignedBlockRoot(input.forkName, block),
          cachedBytes,
          {validSignatures: true}
        );
        expect(validateObject).not.toHaveBeenCalled();
      } else {
        expect(validateObject).toHaveBeenCalledExactlyOnceWith(
          {data: block, bytes: cachedBytes},
          {validSignatures: true}
        );
        expect(validateBytes).not.toHaveBeenCalled();
      }
      expect(stf.verifyBlocksStateTransitionOnly).toHaveBeenCalledOnce();
      expect(vi.mocked(stf.verifyBlocksStateTransitionOnly).mock.calls[0][2][0] === block).toBe(
        beaconEngineMode === BeaconEngineMode.MainThread
      );
      expect(chain.executionEngine.notifyNewPayload).not.toHaveBeenCalled();
      expect(core.seenBlockProposers.isKnown(0, 0)).toBe(false);
      expect(core.verifiedBlocks.size).toBe(0);
      expect(core.blockSerializedCache.get(signedRoot(input))).toBeUndefined();
    }
  );

  it.each([false, true])("preserves a pending import bundle during API validation (failure: %s)", async (failure) => {
    const input = bellatrixInput();
    const [data] = serializeBlocks(input);
    await core.verifyBlocksBytes([data], {validSignatures: true});
    const pending = core.verifiedBlocks.get(signedRoot(input));
    const cached = core.blockSerializedCache.get(signedRoot(input));
    const getOrDeserialize = vi.spyOn(core.blockSerializedCache, "getOrDeserialize");
    const error = new Error("API state transition failed");
    if (failure) vi.mocked(stf.verifyBlocksStateTransitionOnly).mockRejectedValueOnce(error);

    const validating = core.validateApiBlockBytes(data.signedBlockRoot, data.blockBytes, {validSignatures: true});
    if (failure) await expect(validating).rejects.toBe(error);
    else await validating;

    expect(core.verifiedBlocks.get(signedRoot(input))).toBe(pending);
    expect(core.blockSerializedCache.get(signedRoot(input))).toBe(cached);
    expect(getOrDeserialize).not.toHaveBeenCalled();
  });

  it("rejects malformed block bytes before regenerating state", async () => {
    await expect(
      core.verifyBlocksBytes(
        [
          {
            signedBlockRoot: computeSignedBlockRoot(ForkName.bellatrix, ssz.bellatrix.SignedBeaconBlock.defaultValue()),
            blockBytes: new Uint8Array(),
          },
        ],
        {}
      )
    ).rejects.toMatchObject({
      type: {code: "INVALID_BLOCK_SSZ"},
    });
    expect(chain.regen.getPreState).not.toHaveBeenCalled();
  });

  it.each(Object.values(BlockInputSource).flatMap((source) => [false, true].map((cached) => ({source, cached}))))(
    "prepares $source verification bytes and reuses the original block (cached: $cached)",
    async ({source, cached}) => {
      const input = bellatrixInput(false, 0, source);
      const block = input.getBlock();
      const bytes = sszTypesFor(input.forkName).SignedBeaconBlock.serialize(block);
      if (cached) chain.serializedCache.set(block, bytes);
      const serialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "serialize");
      const deserialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "deserialize");
      const result = await facade.beaconEngine.verifyBlocks([input], {validSignatures: true});
      expect(serialize).toHaveBeenCalledTimes(cached ? 0 : 1);
      expect(deserialize).not.toHaveBeenCalled();
      const cachedBytes = chain.serializedCache.get(block);
      expect(cachedBytes).toEqual(bytes);
      if (cached) expect(cachedBytes).toBe(bytes);
      expect(core.verifyBlocks).toHaveBeenCalledExactlyOnceWith([{data: block, bytes: cachedBytes}], {
        validSignatures: true,
      });
      expect(core.verifyBlocksBytes).not.toHaveBeenCalled();
      expect(core.verifyGossipBlockBytes).not.toHaveBeenCalled();
      expect(core.verifyGossipBlock).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty("verifiedBlocks");
      expect(core.verifiedBlocks.get(signedRoot(input))?.block).toBe(block);
      expect(core.verifiedBlocks.get(signedRoot(input))?.blockBytes).toBe(cachedBytes);
      expect(core.verifiedBlocks.size).toBe(1);
    }
  );

  it.each(engineModes)(
    "keeps batch bundles in Core and returns only metadata (worker: %s)",
    async (beaconEngineMode) => {
      chain.opts.beaconEngineMode = beaconEngineMode;
      facade = withBeaconEngineFacade(chain);
      const inputs = [
        bellatrixInput(false, 0, BlockInputSource.byRange),
        bellatrixInput(false, 1, BlockInputSource.byRange),
      ];
      vi.mocked(stf.verifyBlocksStateTransitionOnly).mockResolvedValue({
        postStates: [state, state],
        proposerBalanceDeltas: [0, 0],
        verifyStateTime: 0,
      });
      const result = await facade.beaconEngine.verifyBlocks(inputs, {validSignatures: true});
      if (beaconEngineMode !== BeaconEngineMode.MainThread) {
        expect(core.verifyBlocksBytes).toHaveBeenCalledExactlyOnceWith(serializeBlocks(...inputs), {
          validSignatures: true,
        });
        expect(core.verifyBlocks).not.toHaveBeenCalled();
      } else {
        expect(core.verifyBlocks).toHaveBeenCalledExactlyOnceWith(
          inputs.map((input) => ({data: input.getBlock(), bytes: chain.serializedCache.get(input.getBlock())})),
          {validSignatures: true}
        );
        expect(core.verifyBlocksBytes).not.toHaveBeenCalled();
      }
      expect(core.verifyGossipBlock).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty("verifiedBlocks");
      expect(Object.keys(result).sort()).toEqual(["segmentExecStatus", "verifySignaturesTime", "verifyStateTime"]);
      expect(structuredClone(result)).toEqual(result);
      expect(core.verifiedBlocks.size).toBe(2);
      for (const input of inputs) {
        expect(core.verifiedBlocks.get(signedRoot(input))?.postState, `post-state at slot ${input.slot}`).toBe(state);
      }
    }
  );

  it.each(engineModes)(
    "reuses gossip bytes through verification and import (beaconEngineMode: %s)",
    async (beaconEngineMode) => {
      chain.opts.beaconEngineMode = beaconEngineMode;
      facade = withBeaconEngineFacade(chain);
      core.validateGossipBlockBytes = vi.fn(BeaconEngineCore.prototype.validateGossipBlockBytes.bind(core));
      core.validateGossipBlock = vi.fn(BeaconEngineCore.prototype.validateGossipBlock.bind(core));
      const input = bellatrixInput();
      const block = input.getBlock();
      const bytes = sszTypesFor(input.forkName).SignedBeaconBlock.serialize(block);
      const serializedCache = chain.serializedCache;
      serializedCache.set(block, bytes);
      Object.defineProperty(core, "blockSerializedCache", {
        value: new BlockSerializedCache(core.config),
      });
      vi.spyOn(blockValidation, "validateGossipBlock").mockResolvedValue({skippedSlots: 0});
      const wireBytes = beaconEngineMode !== BeaconEngineMode.MainThread ? structuredClone(bytes) : bytes;
      const validation = await facade.beaconEngine.validateGossipBlock(block, wireBytes, input.forkName, 0);
      expect(validation.err).toBeNull();
      if (beaconEngineMode !== BeaconEngineMode.MainThread) {
        expect(core.validateGossipBlockBytes).toHaveBeenCalledExactlyOnceWith(
          computeSignedBlockRoot(input.forkName, block),
          wireBytes,
          input.forkName,
          0
        );
        expect(core.validateGossipBlock).not.toHaveBeenCalled();
      } else {
        expect(core.validateGossipBlock).toHaveBeenCalledExactlyOnceWith(
          {data: block, bytes: wireBytes},
          input.forkName,
          0
        );
        expect(core.validateGossipBlockBytes).not.toHaveBeenCalled();
      }
      const candidateCache = core.blockSerializedCache;
      const retained = core.verifiedBlocks;
      const cached = candidateCache.get(signedRoot(input));
      expect(cached !== undefined).toBe(beaconEngineMode !== BeaconEngineMode.MainThread);
      const verifiedBlock = cached?.block ?? block;
      if (beaconEngineMode === BeaconEngineMode.MainThread) {
        Object.defineProperty(core, "blockSerializedCache", {
          get: () => {
            throw Error("Object verification must not access the candidate cache");
          },
        });
      }
      const serialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "serialize");
      const deserialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "deserialize");
      const getBytes = vi.spyOn(serializedCache, "get");

      const verification = await facade.beaconEngine.verifyBlocks([input], {validSignatures: true});

      if (beaconEngineMode !== BeaconEngineMode.MainThread) {
        expect(core.verifyGossipBlockBytes).toHaveBeenCalledExactlyOnceWith(
          computeSignedBlockRoot(input.forkName, block),
          {
            validSignatures: true,
          }
        );
        expect(core.verifyBlocks).not.toHaveBeenCalled();
      } else {
        expect(core.verifyBlocks).toHaveBeenCalledExactlyOnceWith([{data: block, bytes}], {
          validSignatures: true,
        });
        expect(vi.mocked(core.verifyBlocks).mock.calls[0][0][0].data).toBe(block);
        expect(vi.mocked(core.verifyBlocks).mock.calls[0][0][0].bytes).toBe(bytes);
        expect(core.verifyGossipBlockBytes).not.toHaveBeenCalled();
      }
      expect(core.verifyGossipBlock).not.toHaveBeenCalled();
      expect(core.verifyBlocksBytes).not.toHaveBeenCalled();
      expect(getBytes).toHaveBeenCalledTimes(beaconEngineMode !== BeaconEngineMode.MainThread ? 0 : 1);
      expect(serialize).not.toHaveBeenCalled();
      expect(deserialize).not.toHaveBeenCalled();
      expect(vi.mocked(stf.verifyBlocksStateTransitionOnly).mock.calls[0][2][0]).toBe(verifiedBlock);
      const bundle = retained.get(signedRoot(input));
      expect(bundle?.block).toBe(verifiedBlock);
      expect(bundle?.blockBytes).toBe(wireBytes);
      expect(retained.size).toBe(1);
      expect(verification).not.toHaveProperty("verifiedBlocks");
      expect(structuredClone(verification)).toEqual(verification);

      if (beaconEngineMode === BeaconEngineMode.MainThread)
        Object.defineProperty(core, "blockSerializedCache", {value: candidateCache});
      candidateCache.delete(signedRoot(input));
      const putBinary = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(core, "db", {value: {block: {putBinary}}});
      Object.defineProperty(core, "checkpointBalancesCache", {value: {processState: vi.fn()}});
      chain.forkChoice.getTime = vi.fn().mockReturnValue(0);
      chain.forkChoice.getFinalizedCheckpoint.mockReturnValue({
        epoch: 0,
        root: Buffer.alloc(32),
        rootHex: toRootHex(Buffer.alloc(32)),
      });
      chain.forkChoice.getJustifiedCheckpoint = vi.fn().mockReturnValue({
        epoch: 0,
        root: Buffer.alloc(32),
        rootHex: toRootHex(Buffer.alloc(32)),
      });
      const reachedForkChoice = new Error("reached fork choice after persistence");
      chain.forkChoice.onBlock = vi.fn(() => {
        throw reachedForkChoice;
      });
      core.importBlock = vi.fn(BeaconEngineCore.prototype.importBlock.bind(core));

      await expect(facade.beaconEngine.importBlock(input, DataAvailabilityStatus.PreData, {})).rejects.toBe(
        reachedForkChoice
      );

      expect(core.importBlock).toHaveBeenCalledExactlyOnceWith(
        computeSignedBlockRoot(input.forkName, block),
        DataAvailabilityStatus.PreData,
        {}
      );
      const verify = vi.mocked(
        beaconEngineMode !== BeaconEngineMode.MainThread ? core.verifyGossipBlockBytes : core.verifyBlocks
      );
      const importing = vi.mocked(core.importBlock);
      expect(
        vi.mocked(
          beaconEngineMode !== BeaconEngineMode.MainThread ? core.validateGossipBlockBytes : core.validateGossipBlock
        ).mock.invocationCallOrder[0]
      ).toBeLessThan(verify.mock.invocationCallOrder[0]);
      expect(verify.mock.invocationCallOrder[0]).toBeLessThan(importing.mock.invocationCallOrder[0]);
      expect(putBinary).toHaveBeenCalledExactlyOnceWith(
        sszTypesFor(input.forkName).BeaconBlock.hashTreeRoot(block.message),
        wireBytes
      );
      expect(putBinary.mock.calls[0][1]).toBe(wireBytes);
      expect(getBytes).toHaveBeenCalledTimes(beaconEngineMode !== BeaconEngineMode.MainThread ? 0 : 1);
      expect(serialize).not.toHaveBeenCalled();
      expect(deserialize).not.toHaveBeenCalled();
      expect(retained.size).toBe(0);
    }
  );

  it("caches fallback gossip bytes on the main thread and retains them for import", async () => {
    const input = bellatrixInput();
    const block = input.getBlock();
    const serialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "serialize");
    const deserialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "deserialize");

    await facade.beaconEngine.verifyBlocks([input], {validSignatures: true});
    const result = await facade.beaconEngine.verifyBlocks([input], {validSignatures: true});

    expect(serialize).toHaveBeenCalledExactlyOnceWith(block);
    expect(chain.serializedCache.get(block)).toBe(serialize.mock.results[0].value);
    expect(result).not.toHaveProperty("verifiedBlocks");
    expect(core.verifiedBlocks.get(signedRoot(input))?.block).toBe(block);
    expect(core.verifiedBlocks.get(signedRoot(input))?.blockBytes).toBe(chain.serializedCache.get(block));
    expect(core.verifiedBlocks.size).toBe(1);
    expect(deserialize).not.toHaveBeenCalled();
  });

  it.each(
    engineModes.flatMap((beaconEngineMode) =>
      ["missing", "evicted", "other_signature"].map((scenario) => ({beaconEngineMode, scenario}))
    )
  )(
    "verifies gossip with a $scenario cached candidate (beaconEngineMode: $beaconEngineMode)",
    async ({beaconEngineMode, scenario}) => {
      chain.opts.beaconEngineMode = beaconEngineMode;
      facade = withBeaconEngineFacade(chain);
      const input = bellatrixInput();
      const [data] = serializeBlocks(input);
      const other = bellatrixInput();
      other.getBlock().signature = Uint8Array.from(other.getBlock().signature);
      other.getBlock().signature[0] = 1;
      const [otherData] = serializeBlocks(other);
      Object.defineProperty(core, "blockSerializedCache", {
        value: new BlockSerializedCache(core.config, {maxItems: 1}),
      });
      if (scenario === "evicted") core.blockSerializedCache.set(signedRoot(input), input.getBlock(), data.blockBytes);
      if (scenario !== "missing")
        core.blockSerializedCache.set(signedRoot(other), other.getBlock(), otherData.blockBytes);
      chain.serializedCache.set(input.getBlock(), data.blockBytes);
      const serialize = vi.spyOn(ssz.bellatrix.SignedBeaconBlock, "serialize");
      const getBytes = vi.spyOn(chain.serializedCache, "get");
      const cacheSet = vi.spyOn(core.blockSerializedCache, "set");
      const cacheGet = vi.spyOn(core.blockSerializedCache, "get");
      const verification = facade.beaconEngine.verifyBlocks([input], {validSignatures: true});

      if (beaconEngineMode !== BeaconEngineMode.MainThread) {
        await expect(verification).rejects.toBeInstanceOf(BlockError);
        await expect(verification).rejects.toMatchObject({
          signedBlock: input.getBlock(),
          type: {code: BlockErrorCode.GOSSIP_BLOCK_NOT_CACHED},
        });
        expect(core.verifyGossipBlockBytes).toHaveBeenCalledExactlyOnceWith(data.signedBlockRoot, {
          validSignatures: true,
        });
        expect(core.verifyBlocks).not.toHaveBeenCalled();
        expect(structuredClone(await vi.mocked(core.verifyGossipBlockBytes).mock.results[0].value)).toEqual({
          err: {code: BlockErrorCode.GOSSIP_BLOCK_NOT_CACHED},
        });
      } else {
        const result = await verification;
        expect(core.verifyBlocks).toHaveBeenCalledExactlyOnceWith([{data: input.getBlock(), bytes: data.blockBytes}], {
          validSignatures: true,
        });
        expect(core.verifyGossipBlockBytes).not.toHaveBeenCalled();
        expect(result).not.toHaveProperty("verifiedBlocks");
        expect(core.verifiedBlocks.get(signedRoot(input))?.block).toBe(input.getBlock());
        expect(core.verifiedBlocks.get(signedRoot(input))?.blockBytes).toBe(data.blockBytes);
      }
      expect(core.verifyBlocksBytes).not.toHaveBeenCalled();
      expect(getBytes).toHaveBeenCalledTimes(beaconEngineMode !== BeaconEngineMode.MainThread ? 0 : 1);
      expect(cacheSet).not.toHaveBeenCalled();
      expect(cacheGet).toHaveBeenCalledTimes(beaconEngineMode !== BeaconEngineMode.MainThread ? 1 : 0);
      expect(serialize).not.toHaveBeenCalled();
      expect(chain.regen.getPreState).toHaveBeenCalledTimes(beaconEngineMode !== BeaconEngineMode.MainThread ? 0 : 1);
      expect(stf.verifyBlocksStateTransitionOnly).toHaveBeenCalledTimes(
        beaconEngineMode !== BeaconEngineMode.MainThread ? 0 : 1
      );
      expect(core.verifiedBlocks.size).toBe(beaconEngineMode !== BeaconEngineMode.MainThread ? 0 : 1);
    }
  );

  it.each(engineModes)(
    "rehydrates a cloned gossip verification failure with the local input (beaconEngineMode: %s)",
    async (beaconEngineMode) => {
      chain.opts.beaconEngineMode = beaconEngineMode;
      facade = withBeaconEngineFacade(chain);
      const input = bellatrixInput();
      const [data] = serializeBlocks(input);
      const remoteBlock = ssz.bellatrix.SignedBeaconBlock.deserialize(structuredClone(data.blockBytes));
      core.blockSerializedCache.set(signedRoot(input), remoteBlock, data.blockBytes);
      vi.mocked(stf.verifyBlocksStateTransitionOnly).mockRejectedValue(
        new BlockError(remoteBlock, {code: BlockErrorCode.INVALID_SIGNATURE, stateSlot: 0})
      );
      const verify = core.verifyGossipBlockBytes;
      core.verifyGossipBlockBytes = vi.fn(async (...args: Parameters<typeof verify>) =>
        structuredClone(await verify(...args))
      );
      const verifyObject = core.verifyBlocks;
      core.verifyBlocks = vi.fn(async (...args: Parameters<typeof verifyObject>) =>
        structuredClone(await verifyObject(...args))
      );
      const verification = facade.beaconEngine.verifyBlocks([input], {validSignatures: true});

      await expect(verification).rejects.toBeInstanceOf(BlockError);
      await verification.catch((error: BlockError) => {
        expect(error.signedBlock).toBe(input.getBlock());
        expect(error.type.code).toBe(BlockErrorCode.INVALID_SIGNATURE);
      });
      expect(core.verifyBlocksBytes).not.toHaveBeenCalled();
      expect(core.verifiedBlocks.size).toBe(0);
    }
  );

  it("rehydrates a cloned engine failure with the second local block", async () => {
    chain.opts.beaconEngineMode = BeaconEngineMode.Worker;
    facade = withBeaconEngineFacade(chain);
    const inputs = [bellatrixInput(false, 1), bellatrixInput(false, 2)];
    const cause = new Error("state transition failed");
    vi.mocked(stf.verifyBlocksStateTransitionOnly).mockImplementation(async (_config, _state, blocks) => {
      throw new BlockError(blocks[1], {
        code: BlockErrorCode.PER_BLOCK_PROCESSING_ERROR,
        blockRoot: inputs[1].blockRootHex,
        error: cause,
      });
    });
    const verify = core.verifyBlocksBytes;
    core.verifyBlocksBytes = vi.fn(async (...args: Parameters<typeof verify>) =>
      structuredClone(await verify(...args))
    );
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
    expect(core.verifyBlocksBytes).toHaveBeenCalledExactlyOnceWith(serializeBlocks(...inputs), {validSignatures: true});
    expect(core.verifyGossipBlockBytes).not.toHaveBeenCalled();
    expect(core.verifyGossipBlock).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledExactlyOnceWith(
      inputs.map((input) => computeSignedBlockRoot(input.forkName, input.getBlock()))
    );
  });

  it.each([
    {opts: {}, expected: 12.75},
    {opts: {seenTimestampSec: 3.5}, expected: 3.5},
  ])("preserves the fractional seen timestamp $expected", async ({opts, expected}) => {
    vi.spyOn(Date, "now").mockReturnValue(12_750);
    const input = bellatrixInput();
    await verifyEngineBlocks.call(core, serializeBlocks(input), {...opts, validSignatures: true});
    expect(core.verifiedBlocks.get(signedRoot(input))?.seenTimestampSec).toBe(expected);
  });

  it.each(["verifyBlocksBytes", "validateApiBlockBytes"] as const)(
    "%s returns a missing parent failure before regenerating state",
    async (method) => {
      chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(null);
      const input = bellatrixInput();
      const [data] = serializeBlocks(input);
      const result =
        method === "verifyBlocksBytes"
          ? core.verifyBlocksBytes([data], {})
          : core.validateApiBlockBytes(data.signedBlockRoot, data.blockBytes, {});
      await expect(result).resolves.toMatchObject({
        err: {blockIndex: 0, blockRoot: input.blockRootHex, type: {code: BlockErrorCode.PARENT_BLOCK_UNKNOWN}},
      });
      expect(chain.regen.getPreState).not.toHaveBeenCalled();
    }
  );

  it.each([PayloadStatus.EMPTY, PayloadStatus.FULL, null])(
    "resolves the Gloas parent in the engine (available variant: %s)",
    async (status) => {
      vi.spyOn(chain.config, "getForkName").mockReturnValue(ForkName.gloas);
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
    const result = await core.verifyBlocksBytes(
      [{signedBlockRoot: computeSignedBlockRoot(input.forkName, input.getBlock()), blockBytes}],
      {
        validSignatures: true,
      }
    );
    expect(result).toMatchObject({err: null, result: {segmentExecStatus: {executionStatuses: [expected]}}});
    expect(core.verifiedBlocks.get(signedRoot(input))?.executionStatus).toBe(expected);
    expect(core.verifiedBlocks.get(signedRoot(input))?.blockBytes).toBe(blockBytes);
    expect(core.seenBlockProposers.isKnown(0, 0)).toBe(true);
  });

  it("starts STF and signatures while the EL request is pending", async () => {
    const response = defer<Awaited<ReturnType<typeof chain.executionEngine.notifyNewPayload>>>();
    chain.executionEngine.notifyNewPayload.mockReturnValue(response.promise);
    const signatures = vi
      .spyOn(signatureVerification, "verifyBlocksSignatures")
      .mockResolvedValue({verifySignaturesTime: 0});
    const verification = core.verifyBlocksBytes(serializeBlocks(bellatrixInput(true)), {});
    await vi.waitFor(() => expect(signatures).toHaveBeenCalledOnce());
    expect(stf.verifyBlocksStateTransitionOnly).toHaveBeenCalledOnce();
    expect(core.seenBlockProposers.isKnown(0, 0)).toBe(false);
    expect(core.verifiedBlocks.size).toBe(0);
    response.resolve({
      status: ExecutionPayloadStatus.VALID,
      latestValidHash: toRootHex(Buffer.alloc(32, 1)),
      validationError: null,
    });
    await verification;
    expect(core.seenBlockProposers.isKnown(0, 0)).toBe(true);
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
    await core.verifyBlocksBytes(serializeBlocks(bellatrixInput()), {
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
    await expect(core.verifyBlocksBytes(serializeBlocks(input), {validSignatures: true})).resolves.toMatchObject({
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
    await expect(core.verifyBlocksBytes(serializeBlocks(bellatrixInput(true)), {validSignatures: true})).rejects.toBe(
      error
    );
    expect(chain.forkChoice.validateLatestHash).not.toHaveBeenCalled();
    expect(core.seenBlockProposers.isKnown(0, 0)).toBe(false);
    expect(core.verifiedBlocks.size).toBe(0);
  });

  it.each(
    (["verifyBlocksBytes", "verifyBlocks", "verifyGossipBlockBytes"] as const).flatMap((method) =>
      ([ExecutionStatus.Syncing, ExecutionStatus.Valid] as const).map((parentStatus) => ({method, parentStatus}))
    )
  )(
    "handles $method invalidation of a $parentStatus parent without publishing structural metadata",
    async ({method, parentStatus}) => {
      const {ForkChoice, ForkChoiceStore, ProtoArray} =
        await vi.importActual<typeof import("@lodestar/fork-choice")>("@lodestar/fork-choice");
      const root = (n: number) => toRootHex(Buffer.alloc(32, n));
      const anchor: ProtoBlock = {
        ...zeroProtoBlock,
        blockRoot: root(2),
        justifiedRoot: root(2),
        finalizedRoot: root(2),
        executionStatus: ExecutionStatus.Valid,
        executionPayloadBlockHash: root(100),
        executionPayloadNumber: 0,
        executionPayloadGasLimit: 30_000_000,
        dataAvailabilityStatus: DataAvailabilityStatus.Available,
      };
      const parent: ProtoBlock = {
        ...anchor,
        slot: 1,
        blockRoot: root(3),
        parentRoot: anchor.blockRoot,
        executionPayloadBlockHash: root(101),
        executionStatus: parentStatus,
      };
      const descendant: ProtoBlock = {
        ...parent,
        slot: 2,
        blockRoot: root(4),
        parentRoot: parent.blockRoot,
        executionPayloadBlockHash: root(102),
        executionStatus: ExecutionStatus.Syncing,
      };
      const protoArray = ProtoArray.initialize(anchor, 0);
      protoArray.onBlock(parent, parent.slot, null);
      protoArray.onBlock(descendant, descendant.slot, null);
      const checkpoint = {epoch: 0, root: fromHex(anchor.blockRoot)};
      const balances = new Uint16Array(0);
      const store = new ForkChoiceStore(
        3,
        checkpoint,
        checkpoint,
        balances,
        () => balances,
        () => null
      );
      const forkChoice = new ForkChoice(core.config, store, protoArray, 0, null);
      core.forkChoice = forkChoice;
      chain.opts.beaconEngineMode = method === "verifyBlocks" ? BeaconEngineMode.MainThread : BeaconEngineMode.Worker;
      facade = withBeaconEngineFacade(chain);
      const onFatal = vi.fn();
      facade.emitter.on(ChainEvent.fatalError, onFatal);
      const snapshot = await BeaconEngineCore.prototype.getChainViewSnapshot.call(core);
      const getAllNodes = vi.spyOn(forkChoice, "getAllNodes");
      const block = ssz.bellatrix.SignedBeaconBlock.defaultValue();
      block.message.slot = 3;
      block.message.parentRoot = fromHex(parent.blockRoot);
      block.message.body.executionPayload.blockHash = Buffer.alloc(32, 1);
      const input = BlockInputPreData.createFromBlock({
        block,
        blockRootHex: toRootHex(ssz.bellatrix.BeaconBlock.hashTreeRoot(block.message)),
        forkName: ForkName.bellatrix,
        daOutOfRange: false,
        source: method === "verifyGossipBlockBytes" ? BlockInputSource.gossip : BlockInputSource.byRange,
        seenTimestampSec: 0,
      });
      if (method === "verifyGossipBlockBytes") {
        const [data] = serializeBlocks(input);
        core.blockSerializedCache.set(signedRoot(input), block, data.blockBytes);
      }
      chain.executionEngine.notifyNewPayload.mockResolvedValue({
        status: ExecutionPayloadStatus.INVALID,
        latestValidHash: anchor.executionPayloadBlockHash,
        validationError: "invalid ancestry",
      });

      const verification = facade.beaconEngine.verifyBlocks([input], {validSignatures: true});
      await expect(verification).rejects.toBeInstanceOf(BlockError);
      await expect(verification).rejects.toMatchObject({type: {code: BlockErrorCode.EXECUTION_ENGINE_INVALID}});
      expect(core[method]).toHaveBeenCalledOnce();
      expect(getAllNodes).not.toHaveBeenCalled();
      expect(core.verifiedBlocks.size).toBe(0);
      expect(forkChoice.getHead().blockRoot).toBe(descendant.blockRoot);
      expect(await BeaconEngineCore.prototype.getChainViewSnapshot.call(core)).toEqual(snapshot);

      if (parentStatus === ExecutionStatus.Syncing) {
        expect(protoArray.nodes.map((node) => node.executionStatus)).toEqual([
          ExecutionStatus.Valid,
          ExecutionStatus.Invalid,
          ExecutionStatus.Invalid,
        ]);
        expect(protoArray.findHead(anchor.blockRoot, 3).blockRoot).toBe(anchor.blockRoot);
        expect(onFatal).not.toHaveBeenCalled();
      } else {
        const error = forkChoice.irrecoverableError;
        expect(error).toBeInstanceOf(Error);
        expect(onFatal).toHaveBeenCalledExactlyOnceWith(error);
        vi.spyOn(forkChoice, "getBlockHexDefaultStatus").mockReturnValue(null);
        await expect(facade.beaconEngine.verifyBlocks([input], {})).rejects.toMatchObject({
          type: {code: BlockErrorCode.PARENT_BLOCK_UNKNOWN},
        });
        expect(onFatal).toHaveBeenCalledOnce();
      }
    }
  );

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
    const [data] = serializeBlocks(input);
    core.blockSerializedCache.set(signedRoot(input), block, data.blockBytes);
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
    expect(core.seenBlockProposers.isKnown(0, 0)).toBe(false);
    expect(core.verifiedBlocks.size).toBe(0);
  });

  it.each(
    engineModes.flatMap((beaconEngineMode) =>
      ["complete", "pending", "rejecting", "regenerating"].map((engineStatus) => ({beaconEngineMode, engineStatus}))
    )
  )(
    "settles $engineStatus verification after DA failure (beaconEngineMode: $beaconEngineMode)",
    async ({beaconEngineMode, engineStatus}) => {
      chain.opts.beaconEngineMode = beaconEngineMode;
      facade = withBeaconEngineFacade(chain);
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
      const [serialized] = serializeBlocks(input);
      core.blockSerializedCache.set(signedRoot(input), block, serialized.blockBytes);
      const verification = verifyBlocksInEpoch.call(facade, zeroProtoBlock, [input], null, {validSignatures: true});
      const rejected = expect(verification).rejects.toBe(error);
      await vi.waitFor(() => expect(chain.regen.getPreState).toHaveBeenCalledOnce());
      const engineVerification = vi.mocked(
        beaconEngineMode !== BeaconEngineMode.MainThread ? core.verifyGossipBlockBytes : core.verifyBlocks
      ).mock.results[0].value;
      if (engineStatus === "complete") {
        await engineVerification;
        expect(core.verifiedBlocks.size).toBe(1);
        expect(core.seenBlockProposers.hasBlockRoot(0, 0, input.blockRootHex)).toBe(true);
        expect(core.seenBlockProposers.isKnown(0, 0)).toBe(true);
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
      expect(discard).toHaveBeenCalledExactlyOnceWith([computeSignedBlockRoot(input.forkName, input.getBlock())]);
      expect(core.seenBlockProposers.hasBlockRoot(0, 0, input.blockRootHex)).toBe(engineStatus !== "rejecting");
      expect(core.seenBlockProposers.isKnown(0, 0)).toBe(engineStatus !== "rejecting");
      expect(core.verifiedBlocks.size).toBe(0);
    }
  );
});
