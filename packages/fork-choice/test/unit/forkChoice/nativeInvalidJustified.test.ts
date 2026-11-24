import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {Slot, phase0, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {
  ExecutionStatus,
  ForkChoiceError,
  ForkChoiceErrorCode,
  LVHInvalidJudged,
  NativeForkChoice,
  PayloadStatus,
} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {genesisSlot, gloasConfig, makeStore, toProtoBlock} from "./proposerHeadTestUtils.js";

describe("NativeForkChoice / invalidated justified checkpoint", () => {
  const genesisRoot = fromHexString(getBlockRoot(genesisSlot));
  const genesisCheckpoint = {epoch: 0, root: genesisRoot};
  const anchorPayload = new Uint8Array(32).fill(0x22);
  const anchorParentPayload = new Uint8Array(32).fill(0x33);
  // P's bid block hash, see `gloasBlock`
  const parentPayload = new Uint8Array(32).fill(genesisSlot + 1);

  function gloasBlock(slot: Slot, parentRoot: Uint8Array, bidParentHash: Uint8Array) {
    const block = ssz.gloas.BeaconBlock.defaultValue();
    block.slot = slot;
    block.parentRoot = parentRoot;
    block.body.signedExecutionPayloadBid.message.parentBlockHash = bidParentHash;
    block.body.signedExecutionPayloadBid.message.blockHash = new Uint8Array(32).fill(slot);
    return block;
  }

  function stateWithUnrealizedJustified(justified: phase0.Checkpoint): IBeaconStateView {
    return {
      currentJustifiedCheckpoint: genesisCheckpoint,
      finalizedCheckpoint: genesisCheckpoint,
      computeUnrealizedCheckpoints: () => ({justifiedCheckpoint: justified, finalizedCheckpoint: genesisCheckpoint}),
      getBlockRootAtSlot: () => genesisRoot,
    } as unknown as IBeaconStateView;
  }

  it("updateTime throws when the epoch-start pull-up realizes an invalidated justified checkpoint", () => {
    const store = makeStore();
    store.currentSlot = SLOTS_PER_EPOCH;
    const forkChoice = new NativeForkChoice(
      gloasConfig,
      store,
      {
        block: toProtoBlock(genesisSlot, toRootHex(new Uint8Array(32)), true, {
          parentBlockHash: toRootHex(anchorParentPayload),
          executionPayloadBlockHash: toRootHex(anchorParentPayload),
          executionStatus: ExecutionStatus.Syncing,
          payloadStatus: PayloadStatus.PENDING,
        }),
        stateSlot: genesisSlot,
        genesisTime: 0,
        genesisValidatorsRoot: new Uint8Array(32),
        justifiedCheckpoint: genesisCheckpoint,
        finalizedCheckpoint: genesisCheckpoint,
        payloadBlockHash: anchorPayload,
        bidParentBlockHash: anchorParentPayload,
      },
      null,
      {computeUnrealized: true}
    );
    const genesisState = stateWithUnrealizedJustified(genesisCheckpoint);
    const importBlock = (block: ReturnType<typeof gloasBlock>, state: IBeaconStateView): string =>
      forkChoice.onBlock(block, state, 0, 0, SLOTS_PER_EPOCH, ExecutionStatus.Syncing, DataAvailabilityStatus.Available)
        .blockRoot;

    // P hangs from genesis EMPTY; J builds on P's payload and justifies itself at its epoch start
    const parentRoot = importBlock(gloasBlock(genesisSlot + 1, genesisRoot, anchorParentPayload), genesisState);
    forkChoice.onExecutionPayload(
      parentRoot,
      toRootHex(parentPayload),
      1,
      30_000_000,
      ExecutionStatus.Syncing,
      DataAvailabilityStatus.Available
    );
    const justifiedBlock = gloasBlock(SLOTS_PER_EPOCH, fromHexString(parentRoot), parentPayload);
    const justifiedRoot = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(justifiedBlock));
    importBlock(justifiedBlock, stateWithUnrealizedJustified({epoch: 1, root: fromHexString(justifiedRoot)}));
    // Imported after J, so J's checkpoint does not protect its payload
    const siblingPayload = toRootHex(new Uint8Array(32).fill(genesisSlot + 2));
    const siblingRoot = importBlock(gloasBlock(genesisSlot + 2, genesisRoot, anchorParentPayload), genesisState);
    forkChoice.onExecutionPayload(
      siblingRoot,
      siblingPayload,
      2,
      30_000_000,
      ExecutionStatus.Syncing,
      DataAvailabilityStatus.Available
    );

    expect(
      forkChoice.validateLatestHash({
        executionStatus: ExecutionStatus.Invalid,
        latestValidExecHash: null,
        invalidateFromBlockRoot: parentRoot,
        invalidateFromBlockHash: toRootHex(parentPayload),
        judged: LVHInvalidJudged.FromBlock,
      })
    ).toEqual({applied: true});
    expect(forkChoice.getBlockHexDefaultStatus(justifiedRoot)?.executionStatus).toBe(ExecutionStatus.Invalid);

    forkChoice.updateTime(2 * SLOTS_PER_EPOCH - 1);
    expect(forkChoice.getJustifiedCheckpoint().epoch).toBe(0);

    let error: unknown;
    try {
      forkChoice.updateTime(2 * SLOTS_PER_EPOCH);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ForkChoiceError);
    expect((error as ForkChoiceError).type).toEqual({
      code: ForkChoiceErrorCode.INVALID_JUSTIFIED_EXECUTION_STATUS,
      epoch: 1,
      root: justifiedRoot,
    });

    // Execution statuses still refresh while the justified block has no head
    expect(
      forkChoice.validateLatestHash({
        executionStatus: ExecutionStatus.Invalid,
        latestValidExecHash: null,
        invalidateFromBlockRoot: siblingRoot,
        invalidateFromBlockHash: siblingPayload,
        judged: LVHInvalidJudged.FromBlock,
      })
    ).toEqual({applied: true});
    expect(forkChoice.getBlockHex(siblingRoot, PayloadStatus.FULL)?.executionStatus).toBe(ExecutionStatus.Invalid);
  });
});
