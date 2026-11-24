import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {RootHex, Slot, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ExecutionStatus, NativeForkChoice, PayloadStatus} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {genesisSlot, gloasConfig, makeStore, toProtoBlock} from "./proposerHeadTestUtils.js";

describe("NativeForkChoice onBlock", () => {
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

  function gloasBlock(slot: Slot, parentRoot: Uint8Array, bidParentHash: Uint8Array) {
    const block = ssz.gloas.BeaconBlock.defaultValue();
    block.slot = slot;
    block.parentRoot = parentRoot;
    block.body.signedExecutionPayloadBid.message.parentBlockHash = bidParentHash;
    block.body.signedExecutionPayloadBid.message.blockHash = new Uint8Array(32).fill(slot);
    return block;
  }

  function importBlock(forkChoice: NativeForkChoice, block: ReturnType<typeof gloasBlock>) {
    return forkChoice.onBlock(
      block,
      state,
      0,
      0,
      block.slot,
      ExecutionStatus.Syncing,
      DataAvailabilityStatus.Available
    );
  }

  it("returns the status of the parent payload a Gloas block builds on", () => {
    const forkChoice = newForkChoice();
    const parentRoot: RootHex = importBlock(
      forkChoice,
      gloasBlock(genesisSlot + 1, genesisRoot, anchorParentPayload)
    ).blockRoot;
    const parentPayload = new Uint8Array(32).fill(genesisSlot + 1);
    forkChoice.onExecutionPayload(
      parentRoot,
      toRootHex(parentPayload),
      1,
      30_000_000,
      ExecutionStatus.Valid,
      DataAvailabilityStatus.Available
    );

    const child = importBlock(forkChoice, gloasBlock(genesisSlot + 2, fromHexString(parentRoot), parentPayload));
    expect(child.executionStatus).toBe(ExecutionStatus.Valid);
    expect(child).toEqual(forkChoice.getBlockHexDefaultStatus(child.blockRoot));
  });
});
