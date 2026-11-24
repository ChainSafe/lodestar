import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {RootHex, Slot, phase0, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {
  ExecutionStatus,
  ForkChoiceError,
  ForkChoiceErrorCode,
  InvalidBlockCode,
  LVHInvalidJudged,
  NativeForkChoice,
  PayloadStatus,
} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {genesisSlot, gloasConfig, makeStore, toProtoBlock} from "./proposerHeadTestUtils.js";

describe("NativeForkChoice / invalidated parent payload chain", () => {
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
  const genesisState = stateWithUnrealizedJustified(genesisCheckpoint);

  function newForkChoice(): NativeForkChoice {
    const store = makeStore();
    store.currentSlot = SLOTS_PER_EPOCH;
    return new NativeForkChoice(
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
  }

  function importBlock(
    forkChoice: NativeForkChoice,
    block: ReturnType<typeof gloasBlock>,
    state: IBeaconStateView = genesisState
  ): RootHex {
    return forkChoice.onBlock(
      block,
      state,
      0,
      0,
      SLOTS_PER_EPOCH,
      ExecutionStatus.Syncing,
      DataAvailabilityStatus.Available
    ).blockRoot;
  }

  function importPayload(forkChoice: NativeForkChoice, blockRoot: RootHex, payload: RootHex, slot: Slot): void {
    forkChoice.onExecutionPayload(
      blockRoot,
      payload,
      slot,
      30_000_000,
      ExecutionStatus.Syncing,
      DataAvailabilityStatus.Available
    );
  }

  function invalidate(forkChoice: NativeForkChoice, blockRoot: RootHex, payload: RootHex): void {
    expect(
      forkChoice.validateLatestHash({
        executionStatus: ExecutionStatus.Invalid,
        latestValidExecHash: null,
        invalidateFromBlockRoot: blockRoot,
        invalidateFromBlockHash: payload,
        judged: LVHInvalidJudged.FromBlock,
      })
    ).toEqual({applied: true});
  }

  // P hangs from genesis EMPTY and gets its payload
  function importParent(forkChoice: NativeForkChoice): RootHex {
    const parentRoot = importBlock(forkChoice, gloasBlock(genesisSlot + 1, genesisRoot, anchorParentPayload));
    importPayload(forkChoice, parentRoot, toRootHex(parentPayload), 1);
    return parentRoot;
  }

  it("onExecutionPayload rejects a payload for a block on an invalidated payload chain", () => {
    const forkChoice = newForkChoice();
    const parentRoot = importParent(forkChoice);
    const childRoot = importBlock(forkChoice, gloasBlock(genesisSlot + 2, fromHexString(parentRoot), parentPayload));
    invalidate(forkChoice, parentRoot, toRootHex(parentPayload));

    let error: unknown;
    try {
      importPayload(forkChoice, childRoot, toRootHex(new Uint8Array(32).fill(genesisSlot + 2)), 2);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ForkChoiceError);
    expect((error as ForkChoiceError).type).toEqual({
      code: ForkChoiceErrorCode.INVALID_BLOCK,
      err: {code: InvalidBlockCode.PARENT_EXECUTION_INVALID, root: parentRoot, hash: toRootHex(parentPayload)},
    });
    expect(forkChoice.getBlockHex(childRoot, PayloadStatus.FULL)).toBeNull();
  });

  it("updateTime throws when the epoch-start pull-up realizes an invalidated justified checkpoint", () => {
    const forkChoice = newForkChoice();
    // J builds on P's payload and justifies itself at its epoch start
    const parentRoot = importParent(forkChoice);
    const justifiedBlock = gloasBlock(SLOTS_PER_EPOCH, fromHexString(parentRoot), parentPayload);
    const justifiedRoot = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(justifiedBlock));
    importBlock(
      forkChoice,
      justifiedBlock,
      stateWithUnrealizedJustified({epoch: 1, root: fromHexString(justifiedRoot)})
    );
    // Imported after J, so J's checkpoint does not protect its payload
    const siblingPayload = toRootHex(new Uint8Array(32).fill(genesisSlot + 2));
    const siblingRoot = importBlock(forkChoice, gloasBlock(genesisSlot + 2, genesisRoot, anchorParentPayload));
    importPayload(forkChoice, siblingRoot, siblingPayload, 2);

    invalidate(forkChoice, parentRoot, toRootHex(parentPayload));
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
    invalidate(forkChoice, siblingRoot, siblingPayload);
    expect(forkChoice.getBlockHex(siblingRoot, PayloadStatus.FULL)?.executionStatus).toBe(ExecutionStatus.Invalid);
  });
});
