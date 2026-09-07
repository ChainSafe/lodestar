import {beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {LogLevel, toRootHex} from "@lodestar/utils";
import {BlockInputNoData} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/types.js";
import {importBlock} from "../../../../src/chain/blocks/importBlock.js";
import {
  PayloadError,
  PayloadErrorCode,
  importExecutionPayload,
} from "../../../../src/chain/blocks/importExecutionPayload.js";
import {processBlocks} from "../../../../src/chain/blocks/index.js";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {AttestationImportOpt} from "../../../../src/chain/blocks/types.js";
import {BlockErrorLogLevel} from "../../../../src/chain/blocks/utils/blockErrorLogLevel.js";
import {assertLinearChainSegment} from "../../../../src/chain/blocks/utils/chainSegment.js";
import {verifyBlocksInEpoch} from "../../../../src/chain/blocks/verifyBlock.js";
import {verifyBlocksSanityChecks} from "../../../../src/chain/blocks/verifyBlocksSanityChecks.js";
import {BlockError, BlockErrorCode} from "../../../../src/chain/errors/index.js";
import {SeenBlockProposers} from "../../../../src/chain/seenCache/seenBlockProposers.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/engine/interface.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {MockBlockInput} from "../../../utils/blockInput.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

vi.mock("../../../../src/chain/blocks/importBlock.js", async (importActual) => {
  const actual = await importActual<typeof import("../../../../src/chain/blocks/importBlock.js")>();
  return {...actual, importBlock: vi.fn()};
});
vi.mock("../../../../src/chain/blocks/importExecutionPayload.js", async (importActual) => {
  const mod = await importActual<typeof import("../../../../src/chain/blocks/importExecutionPayload.js")>();
  return {...mod, importExecutionPayload: vi.fn()};
});
vi.mock("../../../../src/chain/blocks/utils/chainSegment.js");
vi.mock("../../../../src/chain/blocks/verifyBlock.js");
vi.mock("../../../../src/chain/blocks/verifyBlocksSanityChecks.js");

describe("chain / blocks / processBlocks", () => {
  const slot = 1;
  const proposerIndex = 2;
  const config = createChainForkConfig({
    ...configDef,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
  });
  let chain: MockedBeaconChain;
  let seenBlockProposers: SeenBlockProposers;
  let blockInput: MockBlockInput;

  beforeEach(() => {
    vi.clearAllMocks();

    chain = getMockedBeaconChain({config});
    seenBlockProposers = new SeenBlockProposers();
    Object.defineProperty(chain, "seenBlockProposers", {value: seenBlockProposers});

    const block = ssz.deneb.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.proposerIndex = proposerIndex;
    const blockRoot = toRootHex(ssz.deneb.BeaconBlock.hashTreeRoot(block.message));
    blockInput = new MockBlockInput({forkName: ForkName.deneb, slot, blockRootHex: blockRoot});
    blockInput._block = block;

    vi.mocked(verifyBlocksSanityChecks).mockReturnValue({
      relevantBlocks: [blockInput],
      parentSlots: [slot - 1],
      parentBlock: generateProtoBlock({slot: slot - 1}),
    });
    vi.mocked(assertLinearChainSegment).mockReturnValue({warnings: null});
    vi.mocked(importBlock).mockResolvedValue(undefined);
  });

  it("does not mark a proposal as known when execution verification aborts", async () => {
    const block = blockInput.getBlock();
    const execError = new BlockError(block, {
      code: BlockErrorCode.EXECUTION_ENGINE_ERROR,
      execStatus: ExecutionPayloadStatus.ELERROR,
      errorMessage: "test execution error",
    });
    vi.mocked(verifyBlocksInEpoch).mockImplementation(async () => {
      seenBlockProposers.observeBlockRoot(
        slot,
        proposerIndex,
        blockInput.blockRootHex,
        ssz.phase0.SignedBeaconBlockHeader.defaultValue()
      );
      return {
        postStates: [{forkName: ForkName.deneb} as IBeaconStateView],
        proposerBalanceDeltas: [0],
        segmentExecStatus: {execAborted: {blockIndex: 0, execError}},
        blockDAStatuses: [DataAvailabilityStatus.Available],
        payloadDAStatuses: new Map(),
        indexedAttestationsByBlock: [[]],
      };
    });

    await expect(processBlocks.call(chain, [blockInput], null, {})).rejects.toBe(execError);

    expect(seenBlockProposers.hasBlockRoot(slot, proposerIndex, blockInput.blockRootHex)).toBe(true);
    expect(seenBlockProposers.isKnown(slot, proposerIndex)).toBe(false);
    expect(importBlock).not.toHaveBeenCalled();
  });

  it("marks a proposal as known after execution verification succeeds", async () => {
    vi.mocked(verifyBlocksInEpoch).mockImplementation(async () => {
      seenBlockProposers.observeBlockRoot(
        slot,
        proposerIndex,
        blockInput.blockRootHex,
        ssz.phase0.SignedBeaconBlockHeader.defaultValue()
      );
      return {
        postStates: [{forkName: ForkName.deneb} as IBeaconStateView],
        proposerBalanceDeltas: [0],
        segmentExecStatus: {
          execAborted: null,
          executionStatuses: [ExecutionStatus.Valid],
          executionTime: 0,
        },
        blockDAStatuses: [DataAvailabilityStatus.Available],
        payloadDAStatuses: new Map(),
        indexedAttestationsByBlock: [[]],
      };
    });

    await processBlocks.call(chain, [blockInput], null, {});

    expect(seenBlockProposers.isKnown(slot, proposerIndex)).toBe(true);
    expect(importBlock).toHaveBeenCalledOnce();
  });

  it.each([
    {name: "imports a DA-verified payload inline after its block", envelopeBeforeDa: true},
    {name: "does not import an envelope received after the DA verification snapshot", envelopeBeforeDa: false},
  ])("$name", async ({envelopeBeforeDa}) => {
    const gloasConfig = createChainForkConfig({...config, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0});
    chain = getMockedBeaconChain({config: gloasConfig});
    Object.defineProperty(chain, "seenBlockProposers", {value: seenBlockProposers});
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
    const blockRootHex = toRootHex(blockRoot);
    const gloasBlockInput = BlockInputNoData.createFromBlock({
      block,
      blockRootHex,
      forkName: ForkName.gloas,
      daOutOfRange: false,
      source: BlockInputSource.byRange,
      seenTimestampSec: 0,
    });
    const payloadInput = PayloadEnvelopeInput.createFromBlock({
      block,
      blockRootHex,
      forkName: ForkName.gloas,
      sampledColumns: [0],
      custodyColumns: [0],
      daOutOfRange: false,
      source: PayloadEnvelopeInputSource.byRange,
      seenTimestampSec: 0,
    });
    const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    envelope.message.beaconBlockRoot = blockRoot;
    if (envelopeBeforeDa) {
      payloadInput.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.byRange, seenTimestampSec: 1});
    }

    vi.mocked(verifyBlocksSanityChecks).mockReturnValue({
      relevantBlocks: [gloasBlockInput],
      parentSlots: [slot - 1],
      parentBlock: generateProtoBlock({slot: slot - 1}),
    });
    vi.mocked(verifyBlocksInEpoch).mockResolvedValue({
      postStates: [{forkName: ForkName.gloas} as IBeaconStateView],
      proposerBalanceDeltas: [0],
      segmentExecStatus: {
        execAborted: null,
        executionStatuses: [ExecutionStatus.Valid],
        executionTime: 0,
      },
      blockDAStatuses: [DataAvailabilityStatus.NotRequired],
      payloadDAStatuses: new Map(envelopeBeforeDa ? [[slot, DataAvailabilityStatus.NotRequired]] : []),
      indexedAttestationsByBlock: [[]],
    });
    vi.mocked(importBlock).mockImplementationOnce(async () => {
      expect(payloadInput.hasPayloadEnvelope()).toBe(envelopeBeforeDa);
      if (!envelopeBeforeDa) {
        payloadInput.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.byRange, seenTimestampSec: 2});
      }
    });
    vi.mocked(importExecutionPayload).mockResolvedValue(undefined);

    await processBlocks.call(chain, [gloasBlockInput], new Map([[slot, payloadInput]]), {});

    expect(payloadInput.isComplete()).toBe(true);
    expect(importBlock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({blockInput: gloasBlockInput}), {});
    if (envelopeBeforeDa) {
      expect(importExecutionPayload).toHaveBeenCalledExactlyOnceWith(payloadInput, DataAvailabilityStatus.NotRequired, {
        validSignature: false,
      });
      expect(vi.mocked(importBlock).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(importExecutionPayload).mock.invocationCallOrder[0]
      );
    } else {
      expect(importExecutionPayload).not.toHaveBeenCalled();
    }
  });

  it.each([
    {name: "does not import orphaned payload envelopes when attestations are not imported", skipAttestations: true},
    {
      name: "imports orphaned payload envelopes when attestations are imported, weight decides",
      skipAttestations: false,
    },
  ])("$name", async ({skipAttestations}) => {
    const gloasConfig = createChainForkConfig({...config, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0});
    chain = getMockedBeaconChain({config: gloasConfig});
    Object.defineProperty(chain, "seenBlockProposers", {value: seenBlockProposers});
    const payloadInputFor = (blockSlot: number): {blockInput: BlockInputNoData; payloadInput: PayloadEnvelopeInput} => {
      const block = ssz.gloas.SignedBeaconBlock.defaultValue();
      block.message.slot = blockSlot;
      const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
      const blockRootHex = toRootHex(blockRoot);
      const blockInput = BlockInputNoData.createFromBlock({
        block,
        blockRootHex,
        forkName: ForkName.gloas,
        daOutOfRange: false,
        source: BlockInputSource.byRange,
        seenTimestampSec: 0,
      });
      const payloadInput = PayloadEnvelopeInput.createFromBlock({
        block,
        blockRootHex,
        forkName: ForkName.gloas,
        sampledColumns: [0],
        custodyColumns: [0],
        daOutOfRange: false,
        source: PayloadEnvelopeInputSource.byRange,
        seenTimestampSec: 0,
      });
      const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
      envelope.message.beaconBlockRoot = blockRoot;
      payloadInput.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.byRange, seenTimestampSec: 1});
      return {blockInput, payloadInput};
    };
    // parent's payload was orphaned, the block builds on the parent's EMPTY variant but peers still serve the envelope
    const parent = payloadInputFor(slot - 1);
    const current = payloadInputFor(slot);

    vi.mocked(verifyBlocksSanityChecks).mockReturnValue({
      relevantBlocks: [current.blockInput],
      parentSlots: [slot - 1],
      parentBlock: generateProtoBlock({slot: slot - 1}),
    });
    vi.mocked(assertLinearChainSegment).mockReturnValue({
      warnings: [{slot: slot - 1, payloadEnvelopeInput: parent.payloadInput}],
    });
    vi.mocked(verifyBlocksInEpoch).mockResolvedValue({
      postStates: [{forkName: ForkName.gloas} as IBeaconStateView],
      proposerBalanceDeltas: [0],
      segmentExecStatus: {
        execAborted: null,
        executionStatuses: [ExecutionStatus.Valid],
        executionTime: 0,
      },
      blockDAStatuses: [DataAvailabilityStatus.NotRequired],
      payloadDAStatuses: new Map([[slot, DataAvailabilityStatus.NotRequired]]),
      indexedAttestationsByBlock: [[]],
    });
    vi.mocked(importExecutionPayload).mockResolvedValue(undefined);

    const payloadEnvelopes = new Map([
      [slot - 1, parent.payloadInput],
      [slot, current.payloadInput],
    ]);
    await processBlocks.call(
      chain,
      [current.blockInput],
      payloadEnvelopes,
      skipAttestations ? {importAttestations: AttestationImportOpt.Skip} : {}
    );

    const envelopesForDa = vi.mocked(verifyBlocksInEpoch).mock.calls[0][2];
    if (skipAttestations) {
      expect([...(envelopesForDa?.keys() ?? [])]).toEqual([slot]);
      expect(importExecutionPayload).toHaveBeenCalledExactlyOnceWith(
        current.payloadInput,
        DataAvailabilityStatus.NotRequired,
        {validSignature: false}
      );
      expect(chain.seenPayloadEnvelopeInputCache.prune).toHaveBeenCalledExactlyOnceWith(
        parent.payloadInput.blockRootHex
      );
    } else {
      expect([...(envelopesForDa?.keys() ?? [])]).toEqual([slot - 1, slot]);
      expect(chain.seenPayloadEnvelopeInputCache.prune).not.toHaveBeenCalled();
    }
    // the batch's own map is left untouched, range sync still owns it
    expect(payloadEnvelopes.size).toBe(2);
  });

  it.each([
    {
      name: "imports the envelope of a known block that has no FULL variant when all blocks are known",
      headOnEmpty: false,
      skipAttestations: true,
    },
    {
      name: "does not import the envelope of a known block if the head built on its EMPTY variant",
      headOnEmpty: true,
      skipAttestations: true,
    },
    {
      name: "imports the envelope of a known block whose EMPTY variant the head built on when attestations are imported",
      headOnEmpty: true,
      skipAttestations: false,
    },
  ])("$name", async ({headOnEmpty, skipAttestations}) => {
    const gloasConfig = createChainForkConfig({...config, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0});
    chain = getMockedBeaconChain({config: gloasConfig});
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
    const blockRootHex = toRootHex(blockRoot);
    const gloasBlockInput = BlockInputNoData.createFromBlock({
      block,
      blockRootHex,
      forkName: ForkName.gloas,
      daOutOfRange: false,
      source: BlockInputSource.byRange,
      seenTimestampSec: 0,
    });
    const payloadInput = PayloadEnvelopeInput.createFromBlock({
      block,
      blockRootHex,
      forkName: ForkName.gloas,
      sampledColumns: [0],
      custodyColumns: [0],
      daOutOfRange: false,
      source: PayloadEnvelopeInputSource.byRange,
      seenTimestampSec: 0,
    });
    const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    envelope.message.beaconBlockRoot = blockRoot;
    payloadInput.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.byRange, seenTimestampSec: 1});

    // block already imported (PENDING payload), batch only re-delivers it together with its envelope
    vi.mocked(verifyBlocksSanityChecks).mockReturnValue({relevantBlocks: [], parentSlots: [], parentBlock: null});
    vi.spyOn(chain.forkChoice, "hasBlockHex").mockReturnValue(true);
    vi.spyOn(chain.forkChoice, "getBlockHexAndBlockHash").mockReturnValue(null);
    vi.spyOn(chain.forkChoice, "getHead").mockReturnValue(
      headOnEmpty
        ? generateProtoBlock({slot: slot + 1, parentRoot: blockRootHex})
        : generateProtoBlock({slot, blockRoot: blockRootHex})
    );
    // not part of the automocked ForkChoice
    Object.defineProperty(chain.forkChoice, "isDescendant", {value: vi.fn(() => headOnEmpty)});
    vi.mocked(importExecutionPayload).mockResolvedValue(undefined);

    const result = await processBlocks.call(
      chain,
      [gloasBlockInput],
      new Map([[slot, payloadInput]]),
      skipAttestations ? {importAttestations: AttestationImportOpt.Skip} : {}
    );

    expect(verifyBlocksInEpoch).not.toHaveBeenCalled();
    expect(importBlock).not.toHaveBeenCalled();
    if (headOnEmpty && skipAttestations) {
      expect(importExecutionPayload).not.toHaveBeenCalled();
      expect(chain.seenPayloadEnvelopeInputCache.prune).toHaveBeenCalledExactlyOnceWith(blockRootHex);
      expect(chain.recomputeForkChoiceHead).not.toHaveBeenCalled();
      // the skipped orphaned envelope is returned so range sync can log the serving peer/client
      expect(result).toEqual({orphaned: [{slot, payloadEnvelopeInput: payloadInput}], skipped: true});
    } else {
      expect(importExecutionPayload).toHaveBeenCalledExactlyOnceWith(payloadInput, DataAvailabilityStatus.NotRequired, {
        validSignature: false,
      });
      expect(chain.seenPayloadEnvelopeInputCache.prune).not.toHaveBeenCalled();
      expect(chain.recomputeForkChoiceHead).toHaveBeenCalledOnce();
      expect(result).toEqual({orphaned: [], skipped: false});
    }
  });

  // The gloas payload import throws a PayloadError. Range sync relies on it arriving intact so it can
  // read the INVALID/ERROR code and decide peer attribution — getBlockOrPayloadError must pass it
  // through, not flatten it into a generic BEACON_CHAIN_ERROR. (The origin is mocked here; what matters
  // is that a PayloadError raised anywhere in the pipeline is re-thrown unwrapped.)
  it("re-throws a PayloadError unwrapped, without flattening it into BEACON_CHAIN_ERROR", async () => {
    const payloadInput = {slot: 1, blockRootHex: "0x1234"} as unknown as PayloadEnvelopeInput;
    const payloadError = new PayloadError(payloadInput, {
      code: PayloadErrorCode.EXECUTION_ENGINE_INVALID,
      execStatus: ExecutionPayloadStatus.INVALID,
      errorMessage: "bad payload",
    });
    vi.mocked(verifyBlocksInEpoch).mockRejectedValue(payloadError);

    await expect(processBlocks.call(chain, [blockInput], null, {})).rejects.toBe(payloadError);
  });

  it.each([
    {code: PayloadErrorCode.INVALID_SIGNATURE, pruned: true},
    {code: PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR, pruned: true},
    {code: PayloadErrorCode.EXECUTION_ENGINE_INVALID, pruned: true},
    {code: PayloadErrorCode.EXECUTION_ENGINE_ERROR, pruned: false},
    {code: PayloadErrorCode.MISS_BLOCK_STATE, pruned: false},
  ])("prunes the rejected envelope from the seen cache: $code -> $pruned", async ({code, pruned}) => {
    const payloadInput = {slot: 1, blockRootHex: "0x1234"} as unknown as PayloadEnvelopeInput;
    const type = {
      code,
      execStatus: ExecutionPayloadStatus.INVALID,
      errorMessage: "bad payload",
      message: "bad payload",
      blockRootHex: "0x1234",
    } as unknown as PayloadError["type"];
    vi.mocked(verifyBlocksInEpoch).mockRejectedValue(new PayloadError(payloadInput, type));

    await expect(processBlocks.call(chain, [blockInput], null, {})).rejects.toBeInstanceOf(PayloadError);

    if (pruned) {
      expect(chain.seenPayloadEnvelopeInputCache.prune).toHaveBeenCalledExactlyOnceWith("0x1234");
    } else {
      expect(chain.seenPayloadEnvelopeInputCache.prune).not.toHaveBeenCalled();
    }
  });

  it.each([
    // INVALID_SIGNATURE is persisted for debugging on the error path, needs a serializable state
    {code: BlockErrorCode.INVALID_SIGNATURE, pruned: true, state: {slot: 1, serialize: () => new Uint8Array()}},
    {code: BlockErrorCode.NON_LINEAR_PARENT_ROOTS, pruned: true},
    {code: BlockErrorCode.BLACKLISTED_BLOCK, pruned: true},
    {code: BlockErrorCode.PARENT_BLOCK_UNKNOWN, pruned: false},
    {code: BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT, pruned: false},
  ])("prunes the rejected block from the seen cache: $code -> $pruned", async ({code, pruned, state}) => {
    const blockError = new BlockError(blockInput.getBlock(), {code, state} as unknown as BlockError["type"]);
    vi.mocked(verifyBlocksInEpoch).mockRejectedValue(blockError);
    // debug artefacts written on the error path, not part of the mocked chain
    Object.assign(chain, {persistInvalidSszValue: vi.fn(), persistInvalidSszBytes: vi.fn()});

    await expect(processBlocks.call(chain, [blockInput], null, {})).rejects.toBe(blockError);

    if (pruned) {
      expect(chain.seenBlockInputCache.prune).toHaveBeenCalledExactlyOnceWith(blockInput.blockRootHex);
    } else {
      expect(chain.seenBlockInputCache.prune).not.toHaveBeenCalled();
    }
  });

  it.each<{message: string; code: BlockErrorCode | PayloadErrorCode; level: BlockErrorLogLevel}>([
    {message: "Block error", code: BlockErrorCode.PARENT_BLOCK_UNKNOWN, level: LogLevel.debug},
    {message: "Block error", code: BlockErrorCode.NON_LINEAR_PARENT_ROOTS, level: LogLevel.warn},
    {message: "Block error", code: BlockErrorCode.INCORRECT_TIMESTAMP, level: LogLevel.warn},
    {message: "Block error", code: BlockErrorCode.BEACON_CHAIN_ERROR, level: LogLevel.error},
    {message: "Payload error", code: PayloadErrorCode.EXECUTION_ENGINE_ERROR, level: LogLevel.debug},
    {message: "Payload error", code: PayloadErrorCode.EXECUTION_ENGINE_INVALID, level: LogLevel.warn},
  ])("logs $message $code at $level level", async ({message, code, level}) => {
    const {err, slot, blockRoot} = createImportError(message, code);
    vi.mocked(verifyBlocksInEpoch).mockRejectedValue(err);

    await expect(processBlocks.call(chain, [blockInput], null, {})).rejects.toBe(err);

    expect(chain.logger[level]).toHaveBeenCalledExactlyOnceWith(message, {slot, blockRoot}, err);
    const levels: BlockErrorLogLevel[] = [LogLevel.error, LogLevel.warn, LogLevel.debug];
    for (const other of levels.filter((l) => l !== level)) {
      expect(chain.logger[other]).not.toHaveBeenCalledWith(message, expect.anything(), expect.anything());
    }
  });

  it("logs repeats of the same error for the same block at debug level", async () => {
    const {err, slot, blockRoot} = createImportError("Block error", BlockErrorCode.NON_LINEAR_PARENT_ROOTS);
    vi.mocked(verifyBlocksInEpoch).mockRejectedValue(err);

    await expect(processBlocks.call(chain, [blockInput], null, {})).rejects.toBe(err);
    await expect(processBlocks.call(chain, [blockInput], null, {})).rejects.toBe(err);

    expect(chain.logger.warn).toHaveBeenCalledExactlyOnceWith("Block error", {slot, blockRoot}, err);
    expect(chain.logger.debug).toHaveBeenCalledExactlyOnceWith("Block error", {slot, blockRoot}, err);

    // a different error for the same block is not a repeat
    const {err: otherErr} = createImportError("Block error", BlockErrorCode.BLACKLISTED_BLOCK);
    vi.mocked(verifyBlocksInEpoch).mockRejectedValue(otherErr);

    await expect(processBlocks.call(chain, [blockInput], null, {})).rejects.toBe(otherErr);

    expect(chain.logger.warn).toHaveBeenCalledWith("Block error", {slot, blockRoot}, otherErr);
  });

  function createImportError(
    message: string,
    code: BlockErrorCode | PayloadErrorCode
  ): {err: BlockError | PayloadError; slot: number; blockRoot: string} {
    if (message === "Block error") {
      const err = new BlockError(blockInput.getBlock(), {
        code,
        error: new Error("boom"),
      } as unknown as BlockError["type"]);
      return {err, slot: blockInput.getBlock().message.slot, blockRoot: blockInput.blockRootHex};
    }
    const payloadInput = {slot: 1, blockRootHex: "0x1234"} as unknown as PayloadEnvelopeInput;
    const err = new PayloadError(payloadInput, {code, errorMessage: "bad payload"} as unknown as PayloadError["type"]);
    return {err, slot: 1, blockRoot: "0x1234"};
  }

  // Contrast: a plain error (not a Block/Payload error) IS wrapped, which is why the passthrough above
  // has to be selective.
  it("wraps a non-Block/Payload error into BEACON_CHAIN_ERROR", async () => {
    const internalError = new Error("regen boom");
    vi.mocked(verifyBlocksInEpoch).mockRejectedValue(internalError);

    const err = await processBlocks.call(chain, [blockInput], null, {}).then(
      () => null,
      (e) => e
    );
    expect(err).toBeInstanceOf(BlockError);
    expect((err as BlockError).type.code).toBe(BlockErrorCode.BEACON_CHAIN_ERROR);
  });
});
