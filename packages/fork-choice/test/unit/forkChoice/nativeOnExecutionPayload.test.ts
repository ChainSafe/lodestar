import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {IndexedAttestation, RootHex, Slot, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ExecutionStatus, NativeForkChoice, PayloadStatus} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {genesisEpoch, genesisSlot, gloasConfig, makeStore, toProtoBlock} from "./proposerHeadTestUtils.js";

describe("NativeForkChoice onExecutionPayload head", () => {
  const jSlot = genesisSlot;
  const bSlot = genesisSlot + 1;
  const cSlot = genesisSlot + 2;
  const jRoot = fromHexString(getBlockRoot(jSlot));
  const jCheckpoint = {epoch: genesisEpoch, root: jRoot};
  const anchorPayload = new Uint8Array(32).fill(0x22);
  const anchorParentPayload = new Uint8Array(32).fill(0x33);
  const bPayload = new Uint8Array(32).fill(0x11);

  // B and C carry the anchor's bid parent hash, so B hangs from J.EMPTY and C from B.EMPTY. They arrive a slot
  // late, so neither takes the proposer boost, as in the proto-array version of these tests
  function build(currentSlot: Slot, withC: boolean): {forkChoice: NativeForkChoice; bRoot: RootHex; cRoot: RootHex} {
    const store = makeStore();
    store.currentSlot = currentSlot;
    const forkChoice = new NativeForkChoice(
      gloasConfig,
      store,
      {
        block: toProtoBlock(jSlot, toRootHex(new Uint8Array(32)), true, {
          parentBlockHash: toRootHex(anchorParentPayload),
          executionPayloadBlockHash: toRootHex(anchorParentPayload),
          executionStatus: ExecutionStatus.Syncing,
          payloadStatus: PayloadStatus.PENDING,
        }),
        stateSlot: jSlot,
        genesisTime: 0,
        genesisValidatorsRoot: new Uint8Array(32),
        justifiedCheckpoint: jCheckpoint,
        finalizedCheckpoint: jCheckpoint,
        payloadBlockHash: anchorPayload,
        bidParentBlockHash: anchorParentPayload,
      },
      null
    );
    const importBlock = (slot: Slot, parentRoot: Uint8Array, payload: Uint8Array): RootHex => {
      const block = ssz.gloas.BeaconBlock.defaultValue();
      block.slot = slot;
      block.parentRoot = parentRoot;
      block.body.signedExecutionPayloadBid.message.parentBlockHash = anchorParentPayload;
      block.body.signedExecutionPayloadBid.message.blockHash = payload;
      const state = {
        currentJustifiedCheckpoint: jCheckpoint,
        finalizedCheckpoint: jCheckpoint,
        getBlockRootAtSlot: () => jRoot,
      } as unknown as IBeaconStateView;
      return forkChoice.onBlock(
        block,
        state,
        gloasConfig.SLOT_DURATION_MS,
        gloasConfig.SLOT_DURATION_MS,
        currentSlot,
        ExecutionStatus.Syncing,
        DataAvailabilityStatus.Available
      ).blockRoot;
    };
    const bRoot = importBlock(bSlot, jRoot, bPayload);
    const cRoot = withC ? importBlock(cSlot, fromHexString(bRoot), new Uint8Array(32).fill(0x12)) : "";
    return {forkChoice, bRoot, cRoot};
  }

  function vote(slot: Slot, root: RootHex, validators: number[]): IndexedAttestation {
    return {
      attestingIndices: validators,
      data: {slot, index: 0, beaconBlockRoot: fromHexString(root), source: jCheckpoint, target: jCheckpoint},
      signature: new Uint8Array(96),
    };
  }

  function importPayloadB(forkChoice: NativeForkChoice, bRoot: RootHex): {root: RootHex; payloadStatus: PayloadStatus} {
    forkChoice.onExecutionPayload(
      bRoot,
      toRootHex(bPayload),
      bSlot,
      30_000_000,
      ExecutionStatus.Valid,
      DataAvailabilityStatus.Available
    );
    const head = forkChoice.getHead();
    const recomputed = forkChoice.updateHead();
    expect({root: head.blockRoot, payloadStatus: head.payloadStatus}).toEqual({
      root: recomputed.blockRoot,
      payloadStatus: recomputed.payloadStatus,
    });
    return {root: head.blockRoot, payloadStatus: head.payloadStatus};
  }

  it("moves the head to the FULL variant of a block in the current slot", () => {
    const {forkChoice, bRoot} = build(bSlot, false);
    expect(forkChoice.updateHead().payloadStatus).toBe(PayloadStatus.EMPTY);

    expect(importPayloadB(forkChoice, bRoot)).toEqual({root: bRoot, payloadStatus: PayloadStatus.FULL});
  });

  it("moves the head off a late child built on the EMPTY variant of its parent", () => {
    const {forkChoice, bRoot, cRoot} = build(cSlot, true);
    forkChoice.onAttestation(vote(bSlot, bRoot, [0, 1, 2]), "0xb");
    expect(forkChoice.updateHead().blockRoot).toBe(cRoot);

    expect(importPayloadB(forkChoice, bRoot)).toEqual({root: bRoot, payloadStatus: PayloadStatus.FULL});
  });

  it("keeps a child built on the EMPTY variant of its parent with votes as head", () => {
    const {forkChoice, bRoot, cRoot} = build(cSlot + 1, true);
    forkChoice.onAttestation(vote(cSlot, cRoot, [0]), "0xc");
    expect(forkChoice.updateHead().blockRoot).toBe(cRoot);

    expect(importPayloadB(forkChoice, bRoot)).toEqual({root: cRoot, payloadStatus: PayloadStatus.EMPTY});
  });

  it("applies votes queued in the previous slot before taking the head", () => {
    const {forkChoice, bRoot, cRoot} = build(cSlot, true);
    forkChoice.onAttestation(vote(cSlot, bRoot, [0, 1, 2]), "0xb");
    expect(forkChoice.updateHead().blockRoot).toBe(cRoot);
    forkChoice.updateTime(cSlot + 1);

    expect(importPayloadB(forkChoice, bRoot)).toEqual({root: cRoot, payloadStatus: PayloadStatus.EMPTY});
  });
});
