import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ExecutionStatus, NativeForkChoice, PayloadStatus} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {genesisSlot, gloasConfig, makeStore, toProtoBlock} from "./proposerHeadTestUtils.js";

describe("NativeForkChoice onExecutionPayload", () => {
  it("moves the cached head to the FULL variant without another updateHead", () => {
    const genesisRoot = fromHexString(getBlockRoot(genesisSlot));
    const genesisCheckpoint = {epoch: 0, root: genesisRoot};
    const anchorPayload = new Uint8Array(32).fill(0x22);
    const anchorParentPayload = new Uint8Array(32).fill(0x33);
    const forkChoice = new NativeForkChoice(
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
    const headBeforePayload = forkChoice.updateHead();
    expect(headBeforePayload.blockRoot).toBe(blockRoot);
    expect(headBeforePayload.payloadStatus).toBe(PayloadStatus.EMPTY);

    forkChoice.onExecutionPayload(
      blockRoot,
      toRootHex(block.body.signedExecutionPayloadBid.message.blockHash),
      1,
      30_000_000,
      ExecutionStatus.Valid,
      DataAvailabilityStatus.Available
    );

    const head = forkChoice.getHead();
    expect(head.blockRoot).toBe(blockRoot);
    expect(head.payloadStatus).toBe(PayloadStatus.FULL);
  });
});
