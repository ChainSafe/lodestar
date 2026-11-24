import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {Slot, phase0, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ExecutionStatus, NativeForkChoice, PayloadStatus} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {genesisSlot, gloasConfig, makeStore, toProtoBlock} from "./proposerHeadTestUtils.js";

describe("NativeForkChoice getProposerHead", () => {
  const genesisRoot = fromHexString(getBlockRoot(genesisSlot));
  const genesisCheckpoint = {epoch: 0, root: genesisRoot};
  const anchorPayload = new Uint8Array(32).fill(0x22);
  const anchorParentPayload = new Uint8Array(32).fill(0x33);

  function gloasBlock(slot: Slot, parentRoot: Uint8Array) {
    const block = ssz.gloas.BeaconBlock.defaultValue();
    block.slot = slot;
    block.parentRoot = parentRoot;
    block.body.signedExecutionPayloadBid.message.parentBlockHash = anchorParentPayload;
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

  it("brings fork choice to the proposal slot before reading the store", () => {
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
      {computeUnrealized: true, proposerBoostReorg: true}
    );

    // J justifies itself, which the store realizes at the next epoch start
    const justifiedBlock = gloasBlock(SLOTS_PER_EPOCH, genesisRoot);
    const justifiedRoot = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(justifiedBlock));
    const head = forkChoice.onBlock(
      justifiedBlock,
      stateWithUnrealizedJustified({epoch: 1, root: fromHexString(justifiedRoot)}),
      0,
      0,
      SLOTS_PER_EPOCH,
      ExecutionStatus.Syncing,
      DataAvailabilityStatus.Available
    );
    forkChoice.updateTime(2 * SLOTS_PER_EPOCH - 1);
    expect(forkChoice.getJustifiedCheckpoint().epoch).toBe(0);

    forkChoice.getProposerHead(head, 0, 2 * SLOTS_PER_EPOCH);
    expect(forkChoice.getTime()).toBe(2 * SLOTS_PER_EPOCH);
    expect(forkChoice.getJustifiedCheckpoint()).toEqual({
      epoch: 1,
      root: fromHexString(justifiedRoot),
      rootHex: justifiedRoot,
    });
  });
});
