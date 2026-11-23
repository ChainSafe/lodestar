import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {IndexedAttestation, RootHex, Slot} from "@lodestar/types";
import {ExecutionStatus, ForkChoice, PayloadStatus, ProtoArray} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {
  VALIDATOR_COUNT,
  genesisEpoch,
  genesisSlot,
  getPayloadBlockHash,
  gloasConfig,
  makeStore,
  toProtoBlock,
} from "./proposerHeadTestUtils.js";

describe("ForkChoice onExecutionPayload head", () => {
  const jSlot = genesisSlot;
  const bSlot = genesisSlot + 1;
  const cSlot = genesisSlot + 2;
  const jRoot = getBlockRoot(jSlot);
  const bRoot = getBlockRoot(bSlot);
  const cRoot = getBlockRoot(cSlot);
  // B and C carry J's payload hash as parent hash, so B builds on J and C on B.EMPTY
  const onJPayload = {
    executionPayloadBlockHash: getPayloadBlockHash(jSlot),
    targetRoot: jRoot,
    parentBlockHash: getPayloadBlockHash(jSlot),
  };

  function build(currentSlot: Slot, withC: boolean): ForkChoice {
    const protoArray = ProtoArray.initialize(toProtoBlock(jSlot, "0x00", false), jSlot);
    protoArray.onBlock(toProtoBlock(bSlot, jRoot, true, onJPayload), currentSlot, null);
    if (withC) {
      protoArray.onBlock(toProtoBlock(cSlot, bRoot, true, onJPayload), currentSlot, null);
    }
    const store = makeStore();
    store.currentSlot = currentSlot;
    return new ForkChoice(gloasConfig, store, protoArray, VALIDATOR_COUNT, null);
  }

  function vote(slot: Slot, root: RootHex, validators: number[]): IndexedAttestation {
    return {
      attestingIndices: validators,
      data: {
        slot,
        index: 0,
        beaconBlockRoot: fromHexString(root),
        source: {epoch: genesisEpoch, root: fromHexString(jRoot)},
        target: {epoch: genesisEpoch, root: fromHexString(jRoot)},
      },
      signature: new Uint8Array(96),
    };
  }

  function importPayloadB(forkChoice: ForkChoice): {root: RootHex; payloadStatus: PayloadStatus} {
    forkChoice.onExecutionPayload(
      bRoot,
      getPayloadBlockHash(bSlot),
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
    const forkChoice = build(bSlot, false);
    expect(forkChoice.updateHead().payloadStatus).toBe(PayloadStatus.EMPTY);

    expect(importPayloadB(forkChoice)).toEqual({root: bRoot, payloadStatus: PayloadStatus.FULL});
  });

  it("moves the head off a late child built on the EMPTY variant of its parent", () => {
    const forkChoice = build(cSlot, true);
    forkChoice.onAttestation(vote(bSlot, bRoot, [0, 1, 2]), "0xb");
    expect(forkChoice.updateHead().blockRoot).toBe(cRoot);

    expect(importPayloadB(forkChoice)).toEqual({root: bRoot, payloadStatus: PayloadStatus.FULL});
  });

  it("keeps a child built on the EMPTY variant of its parent with votes as head", () => {
    const forkChoice = build(cSlot + 1, true);
    forkChoice.onAttestation(vote(cSlot, cRoot, [0]), "0xc");
    expect(forkChoice.updateHead().blockRoot).toBe(cRoot);

    expect(importPayloadB(forkChoice)).toEqual({root: cRoot, payloadStatus: PayloadStatus.EMPTY});
  });

  it("applies votes queued in the previous slot before taking the head", () => {
    const forkChoice = build(cSlot, true);
    forkChoice.onAttestation(vote(cSlot, bRoot, [0, 1, 2]), "0xb");
    expect(forkChoice.updateHead().blockRoot).toBe(cRoot);
    forkChoice.updateTime(cSlot + 1);

    expect(importPayloadB(forkChoice)).toEqual({root: cRoot, payloadStatus: PayloadStatus.EMPTY});
  });

  it("recomputes the head when its branch lost viability at an epoch boundary", () => {
    const justifiedEpoch = 2;
    const lagRoot = getBlockRoot(3 * SLOTS_PER_EPOCH + 1);
    const viableRoot = getBlockRoot(3 * SLOTS_PER_EPOCH + 2);
    const protoArray = ProtoArray.initialize(toProtoBlock(jSlot, "0x00", false), jSlot);
    // the heavier branch has a voting source behind the store's justified checkpoint
    for (const [slot, epoch] of [
      [3 * SLOTS_PER_EPOCH + 1, justifiedEpoch - 1],
      [3 * SLOTS_PER_EPOCH + 2, justifiedEpoch],
    ]) {
      const checkpoints = {justifiedEpoch: epoch, unrealizedJustifiedEpoch: epoch, targetRoot: jRoot};
      protoArray.onBlock(toProtoBlock(slot, jRoot, true, {...onJPayload, ...checkpoints}), slot, null);
    }
    protoArray.applyScoreChanges({
      attestationDeltas: protoArray.nodes.map((node) =>
        node.payloadStatus !== PayloadStatus.PENDING ? 0 : node.blockRoot === lagRoot ? 2 : 1
      ),
      proposerBoost: null,
      justifiedEpoch,
      justifiedRoot: jRoot,
      finalizedEpoch: genesisEpoch,
      finalizedRoot: jRoot,
      currentSlot: 3 * SLOTS_PER_EPOCH + 3,
    });
    const store = makeStore();
    store.currentSlot = 3 * SLOTS_PER_EPOCH + 3;
    store.justified = {...store.justified, checkpoint: {...store.justified.checkpoint, epoch: justifiedEpoch}};
    const forkChoice = new ForkChoice(gloasConfig, store, protoArray, VALIDATOR_COUNT, null);
    expect(forkChoice.getHead().blockRoot).toBe(lagRoot);
    forkChoice.updateTime(4 * SLOTS_PER_EPOCH);

    forkChoice.onExecutionPayload(
      lagRoot,
      getPayloadBlockHash(3 * SLOTS_PER_EPOCH + 1),
      3 * SLOTS_PER_EPOCH + 1,
      30_000_000,
      ExecutionStatus.Valid,
      DataAvailabilityStatus.Available
    );

    expect(forkChoice.getHead()).toMatchObject({blockRoot: viableRoot, payloadStatus: PayloadStatus.EMPTY});
  });
});
