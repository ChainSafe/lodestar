import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {RootHex, Slot, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ExecutionStatus, NativeForkChoice, PayloadStatus} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {genesisSlot, gloasConfig, makeStore, toProtoBlock} from "./proposerHeadTestUtils.js";

describe("NativeForkChoice non-ancestors", () => {
  const genesisRoot = fromHexString(getBlockRoot(genesisSlot));
  const genesisCheckpoint = {epoch: 0, root: genesisRoot};
  const anchorPayload = new Uint8Array(32).fill(0x22);
  const anchorParentPayload = new Uint8Array(32).fill(0x33);
  const state = {
    currentJustifiedCheckpoint: genesisCheckpoint,
    finalizedCheckpoint: genesisCheckpoint,
    getBlockRootAtSlot: () => genesisRoot,
  } as unknown as IBeaconStateView;

  function newForkChoice(): NativeForkChoice {
    return new NativeForkChoice(
      gloasConfig,
      makeStore(),
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
      null
    );
  }

  // Every block carries the anchor's bid parent hash, so it hangs from its parent's EMPTY variant
  function importBlock(forkChoice: NativeForkChoice, slot: Slot, parentRoot: Uint8Array): RootHex {
    const block = ssz.gloas.BeaconBlock.defaultValue();
    block.slot = slot;
    block.parentRoot = parentRoot;
    block.body.signedExecutionPayloadBid.message.parentBlockHash = anchorParentPayload;
    block.body.signedExecutionPayloadBid.message.blockHash = new Uint8Array(32).fill(slot);
    return forkChoice.onBlock(block, state, 0, 0, slot, ExecutionStatus.Syncing, DataAvailabilityStatus.Available)
      .blockRoot;
  }

  it("leaves out a PENDING start block's own EMPTY and FULL", () => {
    const forkChoice = newForkChoice();
    const blockRoot = importBlock(forkChoice, genesisSlot + 1, genesisRoot);
    forkChoice.onExecutionPayload(
      blockRoot,
      toRootHex(new Uint8Array(32).fill(genesisSlot + 1)),
      1,
      30_000_000,
      ExecutionStatus.Valid,
      DataAvailabilityStatus.Available
    );
    expect(forkChoice.getBlockHex(blockRoot, PayloadStatus.FULL)).not.toBeNull();

    const {ancestors, nonAncestors} = forkChoice.getAllAncestorAndNonAncestorBlocksDefaultStatus(blockRoot);
    expect(ancestors.map((b) => b.blockRoot)).toEqual([blockRoot, getBlockRoot(genesisSlot)]);
    expect(nonAncestors).toEqual([]);
    expect(forkChoice.getAllNonAncestorBlocks(blockRoot, PayloadStatus.FULL).map((b) => b.payloadStatus)).toEqual([
      PayloadStatus.EMPTY,
    ]);
  });

  it("lists a block imported after the start block that does not descend from it", () => {
    const forkChoice = newForkChoice();
    const startRoot = importBlock(forkChoice, genesisSlot + 1, genesisRoot);
    const orphanRoot = importBlock(forkChoice, genesisSlot + 2, genesisRoot);
    importBlock(forkChoice, genesisSlot + 3, fromHexString(startRoot));

    const {nonAncestors} = forkChoice.getAllAncestorAndNonAncestorBlocksDefaultStatus(startRoot);
    expect(nonAncestors.map((b) => [b.blockRoot, b.payloadStatus])).toEqual([[orphanRoot, PayloadStatus.EMPTY]]);
  });
});
