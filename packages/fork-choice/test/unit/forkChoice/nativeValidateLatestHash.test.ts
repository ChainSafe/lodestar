import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {
  ExecutionStatus,
  LVHInvalidJudged,
  LVHNotAppliedReason,
  NativeForkChoice,
  PayloadStatus,
} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {genesisSlot, gloasConfig, makeStore, toProtoBlock} from "./proposerHeadTestUtils.js";

describe("NativeForkChoice validateLatestHash", () => {
  it("reports why a verdict is not applied instead of failing the node", () => {
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
    const payloadHash = toRootHex(block.body.signedExecutionPayloadBid.message.blockHash);
    forkChoice.onExecutionPayload(
      blockRoot,
      payloadHash,
      1,
      30_000_000,
      ExecutionStatus.Syncing,
      DataAvailabilityStatus.Available
    );
    const invalid = {
      executionStatus: ExecutionStatus.Invalid,
      latestValidExecHash: null,
      invalidateFromBlockRoot: blockRoot,
      invalidateFromBlockHash: payloadHash,
    } as const;

    expect(forkChoice.validateLatestHash({...invalid, judged: LVHInvalidJudged.ChildPayload})).toEqual({
      applied: false,
      reason: LVHNotAppliedReason.UnusableLVH,
    });
    expect(
      forkChoice.validateLatestHash({executionStatus: ExecutionStatus.Valid, latestValidExecHash: payloadHash})
    ).toEqual({applied: true});
    expect(forkChoice.getBlockHex(blockRoot, PayloadStatus.FULL)?.executionStatus).toBe(ExecutionStatus.Valid);
    expect(forkChoice.validateLatestHash({...invalid, judged: LVHInvalidJudged.FromBlock})).toEqual({
      applied: false,
      reason: LVHNotAppliedReason.Contradiction,
    });
    expect(
      forkChoice.validateLatestHash({
        ...invalid,
        invalidateFromBlockRoot: toRootHex(new Uint8Array(32).fill(0x44)),
        judged: LVHInvalidJudged.FromBlock,
      })
    ).toMatchObject({applied: false, reason: LVHNotAppliedReason.Error});
  });
});
