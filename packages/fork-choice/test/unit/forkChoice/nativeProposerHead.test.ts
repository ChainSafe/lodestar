import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {Slot, phase0, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ExecutionStatus, NativeForkChoice, PayloadStatus, UpdateHeadOpt} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {VALIDATOR_COUNT, genesisSlot, gloasConfig, makeStore, toProtoBlock} from "./proposerHeadTestUtils.js";

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

  function createForkChoice(currentSlot: Slot): NativeForkChoice {
    const store = makeStore();
    store.currentSlot = currentSlot;
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
      {computeUnrealized: true, proposerBoostReorg: true}
    );
  }

  it("brings fork choice to the proposal slot before reading the store", () => {
    const forkChoice = createForkChoice(SLOTS_PER_EPOCH);

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
  it("applies votes queued for the previous slot before choosing the proposer head", () => {
    const forkChoice = createForkChoice(genesisSlot + 1);
    const state = {
      ...stateWithUnrealizedJustified(genesisCheckpoint),
      validatorCount: VALIDATOR_COUNT,
    } as unknown as IBeaconStateView;
    const blockA = gloasBlock(genesisSlot + 1, genesisRoot);
    const blockB = gloasBlock(genesisSlot + 1, genesisRoot);
    blockB.proposerIndex = 1;
    for (const block of [blockA, blockB]) {
      forkChoice.onBlock(block, state, 0, 0, block.slot, ExecutionStatus.Syncing, DataAvailabilityStatus.Available);
    }
    const rootA = ssz.gloas.BeaconBlock.hashTreeRoot(blockA);
    const rootB = ssz.gloas.BeaconBlock.hashTreeRoot(blockB);
    const votedRoot = forkChoice.updateHead().blockRoot === toRootHex(rootA) ? rootB : rootA;
    forkChoice.onAttestation(
      {
        attestingIndices: Array.from({length: VALIDATOR_COUNT}, (_, i) => i),
        data: {
          slot: genesisSlot + 1,
          index: 0,
          beaconBlockRoot: votedRoot,
          source: genesisCheckpoint,
          target: genesisCheckpoint,
        },
        signature: new Uint8Array(96),
      },
      "",
      false
    );

    const {head} = forkChoice.updateAndGetHead({
      mode: UpdateHeadOpt.GetProposerHead,
      msFromSlot: 0,
      slot: genesisSlot + 2,
    });
    expect(head.blockRoot).toBe(toRootHex(votedRoot));
  });
});
