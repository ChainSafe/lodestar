import assert from "node:assert/strict";
import {createBeaconConfig} from "@lodestar/config";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {
  BUILDER_INDEX_SELF_BUILD,
  DOMAIN_BEACON_PROPOSER,
  DOMAIN_RANDAO,
  FAR_FUTURE_EPOCH,
  ForkName,
  MAX_EFFECTIVE_BALANCE,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {
  DataAvailabilityStatus,
  ExecutionPayloadStatus,
  IBeaconStateView,
  computeSigningRoot,
  computeTimeAtSlot,
  createBeaconStateView,
  interopSecretKey,
} from "@lodestar/state-transition";
import {SignedBeaconBlock, ssz} from "@lodestar/types";
import {generateState} from "../../../../utils/state.js";
import {generateValidators} from "../../../../utils/validator.js";
import {proofConfig, proofForkSlot} from "./fixtures.js";

export const transitionHeadSlot = proofForkSlot + SLOTS_PER_EPOCH + 1;
export const transitionSlots = [
  proofForkSlot - 1,
  proofForkSlot,
  proofForkSlot + 1,
  proofForkSlot + 3,
  transitionHeadSlot,
];

export const transitionOptions = {
  executionPayloadStatus: ExecutionPayloadStatus.valid,
  dataAvailabilityStatus: DataAvailabilityStatus.Available,
  dontTransferCache: true,
};

function createTransitionGenesis(nativeStateTransition: boolean): IBeaconStateView {
  const validators = generateValidators(130, {
    activationEpoch: 0,
    exitEpoch: FAR_FUTURE_EPOCH,
    withdrawableEpoch: FAR_FUTURE_EPOCH,
    effectiveBalance: MAX_EFFECTIVE_BALANCE,
  });
  const state = ssz.fulu.BeaconState.deserialize(generateState({slot: 0, validators}, proofConfig).serialize());
  state.genesisTime = 0;
  state.fork = {
    previousVersion: proofConfig.FULU_FORK_VERSION,
    currentVersion: proofConfig.FULU_FORK_VERSION,
    epoch: 0,
  };
  state.previousEpochParticipation.fill(0);
  state.currentEpochParticipation.fill(0);
  state.inactivityScores = validators.map(() => 0);
  state.latestBlockHeader.bodyRoot = ssz.fulu.BeaconBlockBody.hashTreeRoot(ssz.fulu.BeaconBlockBody.defaultValue());
  state.latestExecutionPayloadHeader.blockHash = new Uint8Array(32).fill(1);
  state.validators.forEach((validator, i) => {
    validator.withdrawalCredentials[31] = i;
    state.balances[i] += i;
  });
  pubkeyCache.ensureCapacity(validators.length);
  return createBeaconStateView({
    nativeStateTransition,
    config: createBeaconConfig(proofConfig, state.genesisValidatorsRoot),
    stateBytes: ssz.fulu.BeaconState.serialize(state),
  });
}

export function createTransitionBlock(preState: IBeaconStateView, slot: number, graffiti = new Uint8Array(32)) {
  const advanced = preState.processSlots(slot, {dontTransferCache: true});
  try {
    const config = createBeaconConfig(proofConfig, advanced.genesisValidatorsRoot);
    const block =
      slot < proofForkSlot ? ssz.fulu.SignedBeaconBlock.defaultValue() : ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.proposerIndex = advanced.getBeaconProposer(slot);
    block.message.parentRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(advanced.latestBlockHeader);
    block.message.body.graffiti = graffiti;
    block.message.body.eth1Data = advanced.eth1Data;
    const sk = interopSecretKey(block.message.proposerIndex);
    block.message.body.randaoReveal = sk
      .sign(computeSigningRoot(ssz.Epoch, advanced.epoch, config.getDomain(slot, DOMAIN_RANDAO)))
      .toBytes();
    const infinity = new Uint8Array(96);
    infinity[0] = 0xc0;
    block.message.body.syncAggregate.syncCommitteeSignature = infinity;
    if ("executionPayload" in block.message.body) {
      const payload = block.message.body.executionPayload;
      const state = ssz.fulu.BeaconState.deserialize(advanced.serialize());
      payload.parentHash = state.latestExecutionPayloadHeader.blockHash;
      payload.blockHash = new Uint8Array(32).fill(slot);
      payload.prevRandao = advanced.getRandaoMix(advanced.epoch);
      payload.timestamp = computeTimeAtSlot(config, slot, advanced.genesisTime);
      payload.blockNumber = state.latestExecutionPayloadHeader.blockNumber + 1;
    } else if ("signedExecutionPayloadBid" in block.message.body) {
      const state = ssz.gloas.BeaconState.deserialize(advanced.serialize());
      const signedBid = block.message.body.signedExecutionPayloadBid;
      signedBid.signature = infinity;
      Object.assign(signedBid.message, {
        builderIndex: BUILDER_INDEX_SELF_BUILD,
        slot,
        parentBlockHash: state.latestExecutionPayloadBid.blockHash,
        blockHash: new Uint8Array(32).fill(slot),
        parentBlockRoot: block.message.parentRoot,
        prevRandao: advanced.getRandaoMix(advanced.epoch),
        executionRequestsRoot: ssz.gloas.ExecutionRequests.hashTreeRoot(ssz.gloas.ExecutionRequests.defaultValue()),
      });
    }
    const postState = preState.stateTransition(
      {block},
      {...transitionOptions, verifyStateRoot: false, verifyProposer: false},
      {}
    );
    block.message.stateRoot = postState.hashTreeRoot();
    block.signature = sk
      .sign(
        computeSigningRoot(
          proofConfig.getForkTypes(slot).BeaconBlock,
          block.message,
          config.getDomain(slot, DOMAIN_BEACON_PROPOSER)
        )
      )
      .toBytes();
    return {block, postState};
  } finally {
    advanced.release();
  }
}

export function createTransitionChain(nativeStateTransition: boolean) {
  const genesis = createTransitionGenesis(nativeStateTransition);
  const states = new Map<number, IBeaconStateView>([[genesis.slot, genesis]]);
  const blocks = new Map<number, SignedBeaconBlock<ForkName.fulu | ForkName.gloas>>();
  const close = () => {
    for (const state of states.values()) state.release();
  };
  try {
    const genesisBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
    genesisBlock.message.stateRoot = genesis.hashTreeRoot();
    blocks.set(0, genesisBlock);
    const anchor = genesis.processSlots(proofForkSlot - 2, {dontTransferCache: true});
    states.set(anchor.slot, anchor);
    let state = anchor;
    for (const slot of transitionSlots) {
      const {block, postState} = createTransitionBlock(state, slot);
      try {
        const verified = state.stateTransition({block}, transitionOptions, {});
        verified.release();
      } catch (error) {
        postState.release();
        throw error;
      }
      states.set(slot, postState);
      blocks.set(slot, block);
      state = postState;
    }
    return {
      anchor,
      states,
      blocks,
      close,
      stateAt(slot: number) {
        const state = states.get(slot);
        assert(state, `Missing transition state at ${slot}`);
        return state;
      },
      blockAt(slot: number) {
        const block = blocks.get(slot);
        assert(block, `Missing transition block at ${slot}`);
        return block;
      },
    };
  } catch (error) {
    close();
    throw error;
  }
}
