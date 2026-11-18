import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ExecutionStatus, NativeForkChoice, PayloadStatus} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {genesisSlot, gloasConfig, makeStore, toProtoBlock} from "./proposerHeadTestUtils.js";

describe("NativeForkChoice non-ancestors", () => {
  it("leaves out a PENDING start block's own EMPTY and FULL", () => {
    const genesisRoot = fromHexString(getBlockRoot(genesisSlot));
    const genesisCheckpoint = {epoch: 0, root: genesisRoot};
    const zeroHex = toRootHex(new Uint8Array(32));
    const anchorPayload = new Uint8Array(32).fill(0x22);
    const anchorParentPayload = new Uint8Array(32).fill(0x33);
    const forkChoice = new NativeForkChoice(
      gloasConfig,
      makeStore(),
      {
        block: toProtoBlock(genesisSlot, zeroHex, true, {
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

    const block = ssz.gloas.BeaconBlock.defaultValue();
    block.slot = genesisSlot + 1;
    block.parentRoot = genesisRoot;
    block.body.signedExecutionPayloadBid.message.parentBlockHash = anchorParentPayload;
    block.body.signedExecutionPayloadBid.message.blockHash = new Uint8Array(32).fill(0x11);
    const state = {
      currentJustifiedCheckpoint: genesisCheckpoint,
      finalizedCheckpoint: genesisCheckpoint,
      getBlockRootAtSlot: () => genesisRoot,
    } as unknown as IBeaconStateView;
    const {blockRoot} = forkChoice.onBlock(
      block,
      state,
      0,
      0,
      block.slot,
      ExecutionStatus.Syncing,
      DataAvailabilityStatus.Available
    );
    forkChoice.onExecutionPayload(
      blockRoot,
      toRootHex(block.body.signedExecutionPayloadBid.message.blockHash),
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
});
