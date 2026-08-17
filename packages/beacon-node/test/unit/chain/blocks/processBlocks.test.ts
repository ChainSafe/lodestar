import {beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {importBlock} from "../../../../src/chain/blocks/importBlock.js";
import {PayloadError, PayloadErrorCode} from "../../../../src/chain/blocks/importExecutionPayload.js";
import {processBlocks} from "../../../../src/chain/blocks/index.js";
import {assertLinearChainSegment} from "../../../../src/chain/blocks/utils/chainSegment.js";
import {verifyBlocksInEpoch} from "../../../../src/chain/blocks/verifyBlock.js";
import {verifyBlocksSanityChecks} from "../../../../src/chain/blocks/verifyBlocksSanityChecks.js";
import {BlockError, BlockErrorCode} from "../../../../src/chain/errors/index.js";
import {SeenBlockProposers} from "../../../../src/chain/seenCache/seenBlockProposers.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/engine/interface.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {MockBlockInput} from "../../../utils/blockInput.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

vi.mock("../../../../src/chain/blocks/importBlock.js");
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

  // The gloas payload import throws a PayloadError. Range sync relies on it arriving intact so it can
  // read the INVALID/ERROR code and decide peer attribution — getBlockOrPayloadError must pass it
  // through, not flatten it into a generic BEACON_CHAIN_ERROR. (The origin is mocked here; what matters
  // is that a PayloadError raised anywhere in the pipeline is re-thrown unwrapped.)
  it("re-throws a PayloadError unwrapped, without flattening it into BEACON_CHAIN_ERROR", async () => {
    const payloadError = new PayloadError({
      code: PayloadErrorCode.EXECUTION_ENGINE_INVALID,
      execStatus: ExecutionPayloadStatus.INVALID,
      errorMessage: "bad payload",
    });
    vi.mocked(verifyBlocksInEpoch).mockRejectedValue(payloadError);

    await expect(processBlocks.call(chain, [blockInput], null, {})).rejects.toBe(payloadError);
  });

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
