import {vi} from "vitest";
import {ChainForkConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkChoice} from "@lodestar/fork-choice";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  BeaconStateGloas,
  BeaconStateView,
  createCachedBeaconState,
  createEmptyEpochCacheImmutableData,
  getEffectiveBalanceIncrementsZeroed,
} from "@lodestar/state-transition";
import {RootHex, Slot, gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ChainEventEmitter, initializeForkChoiceFromUnfinalizedState} from "../../src/chain/index.js";
import {generateState} from "./state.js";

export type UnfinalizedForkChoice = {
  config: ChainForkConfig;
  forkChoice: ForkChoice;
  state: BeaconStateView;
  headSlot: Slot;
  headRoot: RootHex;
  /** Roots of the ancestors of the head, which fork choice only holds placeholders for */
  parentRoot: RootHex;
  justifiedRoot: RootHex;
  finalizedRoot: RootHex;
  /** Root of the payload the head block builds on, `state.latest_payload_root` */
  headParentPayloadRoot: RootHex;
  /** Root of the payload the bid of the head block commits to */
  headPayloadRoot: RootHex;
};

/**
 * A gloas state whose latest block is a gloas block at `slot`, the post-state of that block.
 * The block builds on the payload with block hash 0xc1.. and root 0xc2.., its bid commits to the payload with
 * block hash 0xc3.. and root 0xc4... Roots and block hashes never share a value, so that a lookup by root cannot
 * pass by matching a block hash.
 * The parent, justified (epoch 2) and finalized (epoch 1) blocks have the roots 0xa1.., 0xa2.. and 0xa3...
 */
export function generateGloasAnchorState(config: ChainForkConfig, slot: Slot): BeaconStateView {
  const parentRoot = Buffer.alloc(32, 0xa1);
  const stateValue = generateState({slot}, config) as BeaconStateGloas;
  stateValue.latestBlockHeader = ssz.phase0.BeaconBlockHeader.toViewDU({
    slot,
    proposerIndex: 0,
    parentRoot,
    stateRoot: Buffer.alloc(32),
    bodyRoot: Buffer.alloc(32, 0xb0),
  });
  stateValue.currentJustifiedCheckpoint = ssz.phase0.Checkpoint.toViewDU({epoch: 2, root: Buffer.alloc(32, 0xa2)});
  stateValue.finalizedCheckpoint = ssz.phase0.Checkpoint.toViewDU({epoch: 1, root: Buffer.alloc(32, 0xa3)});
  stateValue.latestBlockHash = Buffer.alloc(32, 0xc1);
  stateValue.latestPayloadRoot = Buffer.alloc(32, 0xc2);
  stateValue.latestExecutionPayloadBid.parentBlockHash = Buffer.alloc(32, 0xc1);
  stateValue.latestExecutionPayloadBid.parentPayloadRoot = Buffer.alloc(32, 0xc2);
  stateValue.latestExecutionPayloadBid.parentBlockRoot = parentRoot;
  stateValue.latestExecutionPayloadBid.blockHash = Buffer.alloc(32, 0xc3);
  stateValue.latestExecutionPayloadBid.payloadRoot = Buffer.alloc(32, 0xc4);
  stateValue.latestExecutionPayloadBid.slot = slot;
  stateValue.commit();
  return new BeaconStateView(
    // The pubkey cache is shared with every other state of the test file, whose validators have other pubkeys.
    // Nothing here needs the sync committees, which are the only pubkeys looked up
    createCachedBeaconState(stateValue, createEmptyEpochCacheImmutableData(config, stateValue), {
      skipSyncCommitteeCache: true,
    })
  );
}

/**
 * Fork choice of a node restarted from an unfinalized gloas state, built by the same code as the node:
 * `initializeForkChoiceFromUnfinalizedState`. The head is the latest block of the state, its parent and the
 * justified and finalized blocks are only known by root.
 */
export async function initForkChoiceFromUnfinalizedGloasState(): Promise<UnfinalizedForkChoice> {
  // test/mocks/mockedBeaconChain.ts mocks the ForkChoice class for every test file that imports it
  const {ForkChoice: ActualForkChoice} =
    await vi.importActual<typeof import("@lodestar/fork-choice")>("@lodestar/fork-choice");
  const config = getConfig(ForkName.gloas);
  const headSlot = 3 * SLOTS_PER_EPOCH + 5;
  const state = generateGloasAnchorState(config, headSlot);
  const stateValue = state.cachedState as BeaconStateGloas;

  const forkChoice = initializeForkChoiceFromUnfinalizedState(
    config,
    new ChainEventEmitter(),
    headSlot + 1,
    state,
    {forkchoiceConstructor: ActualForkChoice},
    () => getEffectiveBalanceIncrementsZeroed(state.validatorCount),
    () => null,
    null
  );

  return {
    config,
    forkChoice,
    state,
    headSlot,
    headRoot: toRootHex(state.computeAnchorCheckpoint().checkpoint.root),
    parentRoot: toRootHex(stateValue.latestBlockHeader.parentRoot),
    justifiedRoot: toRootHex(stateValue.currentJustifiedCheckpoint.root),
    finalizedRoot: toRootHex(stateValue.finalizedCheckpoint.root),
    headParentPayloadRoot: toRootHex(stateValue.latestPayloadRoot),
    headPayloadRoot: toRootHex(stateValue.latestExecutionPayloadBid.payloadRoot),
  };
}

/**
 * A gloas block at `slot` that builds on the block `parentRoot` and the payload `parentPayloadRoot`. Whether it is
 * valid depends on the real parent block only, which fork choice does not have if the parent is a placeholder.
 */
export function generateGloasBlockOnParent(
  slot: Slot,
  parentRoot: RootHex,
  parentPayloadRoot: Uint8Array
): gloas.SignedBeaconBlock {
  const block = ssz.gloas.SignedBeaconBlock.defaultValue();
  block.message.slot = slot;
  block.message.parentRoot = Buffer.from(parentRoot.slice(2), "hex");
  const bid = block.message.body.signedExecutionPayloadBid.message;
  bid.slot = slot;
  bid.parentBlockRoot = block.message.parentRoot;
  bid.parentBlockHash = Buffer.alloc(32, 0xd1);
  bid.parentPayloadRoot = parentPayloadRoot;
  bid.blockHash = Buffer.alloc(32, 0xd3);
  bid.payloadRoot = Buffer.alloc(32, 0xd4);
  return block;
}
