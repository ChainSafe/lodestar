import type {PubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {routes} from "@lodestar/api";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {
  EPOCHS_PER_HISTORICAL_VECTOR,
  ForkName,
  ForkSeq,
  GENESIS_SLOT,
  MIN_SEED_LOOKAHEAD,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SUBNET_SIZE,
} from "@lodestar/params";
import {
  IBeaconStateView,
  IBeaconStateViewGloas,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getCurrentEpoch,
  getEffectiveBalancesFromStateBytes,
  getIndexedAttestation,
  isStatePostAltair,
  isStatePostCapella,
  isStatePostElectra,
  isStatePostFulu,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {
  Attestation,
  BLSPubkey,
  BuilderIndex,
  Bytes32,
  CommitteeIndex,
  Epoch,
  IndexedAttestation,
  Root,
  RootHex,
  Slot,
  ValidatorIndex,
  capella,
  electra,
  fulu,
  getBuilderStatus,
  getValidatorStatus,
  gloas,
  mapToGeneralStatus,
  phase0,
  ssz,
  sszTypesFor,
} from "@lodestar/types";
import {byteArrayEquals, fromHex, toRootHex} from "@lodestar/utils";
import {GENESIS_EPOCH} from "../../constants/index.js";
import {isOptimisticBlock} from "../../util/forkChoice.js";
import {StateGetOpts} from "../interface.js";
import {RegenCaller} from "../regen/index.js";
import type {BeaconEngineCore} from "./beaconEngineCore.js";
import type {ApiStateId} from "./interface.js";
import {ApiStateResult, ApiStateResultWithFork} from "./interface.js";

const genesisStateRoots = new WeakMap<BeaconEngineCore, RootHex | null>();

/** Resolve an API stateId (already reduced to root/slot/checkpoint) to a state view or bytes. */
async function resolveStateForApi(
  this: BeaconEngineCore,
  id: ApiStateId
): Promise<{state: IBeaconStateView | Uint8Array; executionOptimistic: boolean; finalized: boolean} | null> {
  if (typeof id === "object" && "head" in id) {
    const head = this.forkChoice.getHead();
    const state = this.regen.getStateSync(head.stateRoot) ?? this.getHeadState();
    const finalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;
    return {
      state,
      executionOptimistic: isOptimisticBlock(head),
      finalized: state.epoch <= finalizedEpoch && finalizedEpoch !== GENESIS_EPOCH,
    };
  }
  if (typeof id === "string") {
    return getStateByStateRoot.call(this, id, {allowRegen: true});
  }
  if (typeof id === "number") {
    if (id > this.clock.currentSlot) {
      return null; // Don't try to serve future slots
    }
    return id >= this.forkChoice.getFinalizedBlock().slot
      ? getStateBySlot.call(this, id, {allowRegen: true})
      : this.getHistoricalStateBySlot(id);
  }
  return getStateOrBytesByCheckpoint.call(this, id);
}

/** Resolve to a state *view* (deserializing archive/checkpoint bytes engine-side onto the head state). */
async function resolveStateViewForApi(
  this: BeaconEngineCore,
  id: ApiStateId
): Promise<{state: IBeaconStateView; executionOptimistic: boolean; finalized: boolean} | null> {
  const res = await resolveStateForApi.call(this, id);
  if (!res) {
    return null;
  }
  const state = res.state instanceof Uint8Array ? this.getHeadState().loadOtherState(res.state) : res.state;
  return {state, executionOptimistic: res.executionOptimistic, finalized: res.finalized};
}

/** Serialized state for the debug `getStateV2` endpoint (the only whole-state-bytes crossing). */
export async function getSerializedState(
  this: BeaconEngineCore,
  id: ApiStateId
): Promise<{state: Uint8Array; executionOptimistic: boolean; finalized: boolean} | null> {
  const res = await resolveStateForApi.call(this, id);
  if (!res) {
    return null;
  }
  const state = res.state instanceof Uint8Array ? res.state : res.state.serialize();
  return {state, executionOptimistic: res.executionOptimistic, finalized: res.finalized};
}

/** Effective balances of `validatorIndices` from the finalized checkpoint state (custody group count). */
export async function getFinalizedEffectiveBalances(
  this: BeaconEngineCore,
  finalizedCheckpoint: CheckpointWithHex,
  validatorIndices: ValidatorIndex[]
): Promise<number[] | null> {
  const stateOrBytes = (await getStateOrBytesByCheckpoint.call(this, finalizedCheckpoint))?.state;
  if (!stateOrBytes) {
    return null;
  }
  if (stateOrBytes instanceof Uint8Array) {
    return getEffectiveBalancesFromStateBytes(this.config, stateOrBytes, validatorIndices);
  }
  return validatorIndices.map((index) => stateOrBytes.getValidator(index).effectiveBalance ?? 0);
}

/** Multi-proof of the resolved state for the given SSZ `descriptor`; null if the state is unavailable. */
export async function getStateProof(
  this: BeaconEngineCore,
  id: ApiStateId,
  descriptor: Uint8Array
): Promise<{proof: CompactMultiProof; fork: ForkName} | null> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) {
    return null;
  }
  return {proof: res.state.createMultiProof(descriptor), fork: this.config.getForkName(res.state.slot)};
}

/** Historical summaries + single-proof of the resolved state; null if unavailable (post-capella only). */
export async function getHistoricalSummaries(
  this: BeaconEngineCore,
  id: ApiStateId
): Promise<{
  slot: Slot;
  historicalSummaries: capella.HistoricalSummaries;
  proof: Uint8Array[];
  fork: ForkName;
  executionOptimistic: boolean;
  finalized: boolean;
} | null> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) {
    return null;
  }
  const {state, executionOptimistic, finalized} = res;
  const fork = this.config.getForkName(state.slot);
  if (ForkSeq[fork] < ForkSeq.capella) {
    throw new Error("Historical summaries are not supported before Capella");
  }
  if (!isStatePostCapella(state)) {
    throw new Error("Expected Capella state for historical summaries");
  }
  const {gindex} = ssz[fork].BeaconState.getPathInfo(["historicalSummaries"]);
  return {
    slot: state.slot,
    historicalSummaries: state.historicalSummaries,
    proof: state.getSingleProof(gindex),
    fork,
    executionOptimistic,
    finalized,
  };
}

/** Resolve per-epoch shuffling and build indexed attestations (attester-slashing debug helper). */
export async function getIndexedAttestationsForSlashing(
  this: BeaconEngineCore,
  requests: {slot: Slot; epoch: Epoch; attestations: Attestation[]}[],
  forkSeq: ForkSeq
): Promise<IndexedAttestation[]> {
  const indexed: IndexedAttestation[] = [];
  for (const {slot, epoch, attestations} of requests) {
    const res = await resolveStateViewForApi.call(this, slot);
    if (!res) {
      throw Error(`State not available for slot ${slot}`);
    }
    const shuffling = res.state.getShufflingAtEpoch(epoch);
    for (const attestation of attestations) {
      indexed.push(getIndexedAttestation(shuffling, forkSeq, attestation));
    }
  }
  return indexed;
}

export async function getStateBuilders(
  this: BeaconEngineCore,
  id: ApiStateId,
  builderIds: routes.beacon.BuilderId[],
  statuses: string[]
): Promise<ApiStateResult<routes.beacon.BuilderResponse[]>> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) return null;
  const {state, executionOptimistic, finalized} = res;
  if (!isStatePostGloas(state)) {
    return {invalid: {code: 400, message: `Builders are not supported for pre-gloas state fork=${state.forkName}`}};
  }
  const finalizedEpoch = state.finalizedCheckpoint.epoch;

  const builderResponses: routes.beacon.BuilderResponse[] = [];
  if (builderIds.length) {
    for (const id of builderIds) {
      const resp = getStateBuilderIndex(id, state);
      if (resp.valid) {
        const builderIndex = resp.builderIndex;
        const builder = state.getBuilder(builderIndex);
        const status = getBuilderStatus(builder, finalizedEpoch);
        if (statuses.length && !statuses.includes(status)) {
          continue;
        }
        builderResponses.push({index: builderIndex, status, builder: ssz.gloas.Builder.clone(builder)});
      }
    }
    return {
      data: builderResponses,
      executionOptimistic,
      finalized,
    };
  }

  if (statuses.length) {
  }

  const buildersLength = state.getBuildersLength();
  for (let builderIndex = 0; builderIndex < buildersLength; builderIndex++) {
    const builder = state.getBuilder(builderIndex);
    const status = getBuilderStatus(builder, finalizedEpoch);
    if (statuses.length && !statuses.includes(status)) {
      continue;
    }
    builderResponses.push({index: builderIndex, status, builder: ssz.gloas.Builder.clone(builder)});
  }

  return {
    data: builderResponses,
    executionOptimistic,
    finalized,
  };
}

function toValidatorResponse(
  index: ValidatorIndex,
  validator: phase0.Validator,
  balance: number,
  currentEpoch: Epoch
): routes.beacon.ValidatorResponse {
  return {index, status: getValidatorStatus(validator, currentEpoch), balance, validator};
}

function resolveStateValidatorIndex(
  this: BeaconEngineCore,
  id: routes.beacon.ValidatorId | BLSPubkey,
  state: IBeaconStateView
): StateValidatorIndexResponse {
  return getStateValidatorIndex(id, state, this.pubkeyCache);
}

function filterStateValidatorsByStatus(
  this: BeaconEngineCore,
  statuses: string[],
  state: IBeaconStateView,
  currentEpoch: Epoch
): routes.beacon.ValidatorResponse[] {
  const responses: routes.beacon.ValidatorResponse[] = [];
  const validators = state.getValidatorsByStatus(new Set(statuses), currentEpoch);
  for (const validator of validators) {
    const resp = resolveStateValidatorIndex.call(this, validator.pubkey, state);
    if (resp.valid) {
      responses.push(
        toValidatorResponse(resp.validatorIndex, validator, state.getBalance(resp.validatorIndex), currentEpoch)
      );
    }
  }
  return responses;
}

export async function getStateRoot(this: BeaconEngineCore, id: ApiStateId): Promise<ApiStateResult<{root: Root}>> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) return null;
  return {
    data: {root: res.state.hashTreeRoot()},
    executionOptimistic: res.executionOptimistic,
    finalized: res.finalized,
  };
}

export async function getStateFork(this: BeaconEngineCore, id: ApiStateId): Promise<ApiStateResult<phase0.Fork>> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) return null;
  return {data: res.state.fork, executionOptimistic: res.executionOptimistic, finalized: res.finalized};
}

export async function getStateRandao(
  this: BeaconEngineCore,
  id: ApiStateId,
  epoch?: Epoch
): Promise<ApiStateResult<{randao: Bytes32}>> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) return null;
  const {state, executionOptimistic, finalized} = res;
  const stateEpoch = computeEpochAtSlot(state.slot);
  const usedEpoch = epoch ?? stateEpoch;
  if (!(stateEpoch < usedEpoch + EPOCHS_PER_HISTORICAL_VECTOR && usedEpoch <= stateEpoch)) {
    return {invalid: {code: 400, message: "Requested epoch is out of range"}};
  }
  return {data: {randao: state.getRandaoMix(usedEpoch)}, executionOptimistic, finalized};
}

export async function getStateFinalityCheckpoints(
  this: BeaconEngineCore,
  id: ApiStateId
): Promise<
  ApiStateResult<{
    currentJustified: phase0.Checkpoint;
    previousJustified: phase0.Checkpoint;
    finalized: phase0.Checkpoint;
  }>
> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) return null;
  const {state, executionOptimistic, finalized} = res;
  return {
    data: {
      currentJustified: ssz.phase0.Checkpoint.clone(state.currentJustifiedCheckpoint),
      previousJustified: ssz.phase0.Checkpoint.clone(state.previousJustifiedCheckpoint),
      finalized: ssz.phase0.Checkpoint.clone(state.finalizedCheckpoint),
    },
    executionOptimistic,
    finalized,
  };
}

export async function getStateValidators(
  this: BeaconEngineCore,
  id: ApiStateId,
  validatorIds: routes.beacon.ValidatorId[],
  statuses: string[]
): Promise<ApiStateResult<routes.beacon.ValidatorResponse[]>> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) return null;
  const {state, executionOptimistic, finalized} = res;
  const currentEpoch = getCurrentEpoch(state);

  let data: routes.beacon.ValidatorResponse[];
  if (validatorIds.length) {
    data = [];
    for (const vid of validatorIds) {
      const resp = resolveStateValidatorIndex.call(this, vid, state);
      if (resp.valid) {
        const validator = state.getValidator(resp.validatorIndex);
        const status = getValidatorStatus(validator, currentEpoch);
        if (statuses.length && !statuses.includes(status) && !statuses.includes(mapToGeneralStatus(status))) {
          continue;
        }
        data.push(
          toValidatorResponse(resp.validatorIndex, validator, state.getBalance(resp.validatorIndex), currentEpoch)
        );
      }
    }
  } else if (statuses.length) {
    data = filterStateValidatorsByStatus.call(this, statuses, state, currentEpoch);
  } else {
    // TODO: This loops over the entire state, it's a DOS vector
    const validatorsArr = state.getAllValidators();
    const balancesArr = state.getAllBalances();
    data = [];
    for (let i = 0; i < validatorsArr.length; i++) {
      data.push(toValidatorResponse(i, validatorsArr[i], balancesArr[i], currentEpoch));
    }
  }
  return {data, executionOptimistic, finalized};
}

export async function getStateValidatorIdentities(
  this: BeaconEngineCore,
  id: ApiStateId,
  validatorIds: routes.beacon.ValidatorId[]
): Promise<ApiStateResult<routes.beacon.ValidatorIdentities>> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) return null;
  const {state, executionOptimistic, finalized} = res;

  let data: routes.beacon.ValidatorIdentities;
  if (validatorIds.length) {
    data = [];
    for (const vid of validatorIds) {
      const resp = resolveStateValidatorIndex.call(this, vid, state);
      if (resp.valid) {
        const {pubkey, activationEpoch} = state.getValidator(resp.validatorIndex);
        data.push({index: resp.validatorIndex, pubkey, activationEpoch});
      }
    }
  } else {
    const validatorsArr = state.getAllValidators();
    data = new Array(validatorsArr.length) as routes.beacon.ValidatorIdentities;
    for (let i = 0; i < validatorsArr.length; i++) {
      const {pubkey, activationEpoch} = validatorsArr[i];
      data[i] = {index: i, pubkey, activationEpoch};
    }
  }
  return {data, executionOptimistic, finalized};
}

export async function getStateValidator(
  this: BeaconEngineCore,
  id: ApiStateId,
  validatorId: routes.beacon.ValidatorId
): Promise<ApiStateResult<routes.beacon.ValidatorResponse>> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) return null;
  const {state, executionOptimistic, finalized} = res;
  const resp = resolveStateValidatorIndex.call(this, validatorId, state);
  if (!resp.valid) {
    return {invalid: {code: resp.code, message: resp.reason}};
  }
  return {
    data: toValidatorResponse(
      resp.validatorIndex,
      state.getValidator(resp.validatorIndex),
      state.getBalance(resp.validatorIndex),
      getCurrentEpoch(state)
    ),
    executionOptimistic,
    finalized,
  };
}

export async function getStateValidatorBalances(
  this: BeaconEngineCore,
  id: ApiStateId,
  validatorIds: routes.beacon.ValidatorId[]
): Promise<ApiStateResult<routes.beacon.ValidatorBalance[]>> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) return null;
  const {state, executionOptimistic, finalized} = res;

  let data: routes.beacon.ValidatorBalance[];
  if (validatorIds.length) {
    data = [];
    for (const vid of validatorIds) {
      const resp = resolveStateValidatorIndex.call(this, vid, state);
      if (resp.valid) {
        data.push({index: resp.validatorIndex, balance: state.getBalance(resp.validatorIndex)});
      }
    }
  } else {
    // TODO: This loops over the entire state, it's a DOS vector
    const balancesArr = state.getAllBalances();
    data = [];
    for (let i = 0; i < balancesArr.length; i++) {
      data.push({index: i, balance: balancesArr[i]});
    }
  }
  return {data, executionOptimistic, finalized};
}

export async function getEpochCommittees(
  this: BeaconEngineCore,
  id: ApiStateId,
  filters: {epoch?: Epoch; index?: CommitteeIndex; slot?: Slot}
): Promise<ApiStateResult<routes.beacon.EpochCommitteeResponse[]>> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) return null;
  const {state, executionOptimistic, finalized} = res;

  const stateEpoch = computeEpochAtSlot(state.slot);
  const epoch = filters.epoch ?? stateEpoch;
  const startSlot = computeStartSlotAtEpoch(epoch);
  const endSlot = startSlot + SLOTS_PER_EPOCH - 1;

  if (Math.abs(epoch - stateEpoch) > 1) {
    return {invalid: {code: 400, message: `Epoch ${epoch} must be within one epoch of state epoch ${stateEpoch}`}};
  }
  if (filters.slot !== undefined && (filters.slot < startSlot || filters.slot > endSlot)) {
    return {invalid: {code: 400, message: `Slot ${filters.slot} is not in epoch ${epoch}`}};
  }

  const decisionRoot = state.getShufflingDecisionRoot(epoch);
  const shuffling = await this.shufflingCache.get(epoch, decisionRoot);
  if (!shuffling) {
    return {
      invalid: {
        code: 500,
        message: `No shuffling found to calculate committees for epoch: ${epoch} and decisionRoot: ${decisionRoot}`,
      },
    };
  }
  const data = shuffling.committees.flatMap((slotCommittees, slotInEpoch) => {
    const slot = startSlot + slotInEpoch;
    if (filters.slot !== undefined && filters.slot !== slot) {
      return [];
    }
    return slotCommittees.flatMap((committee, committeeIndex) => {
      if (filters.index !== undefined && filters.index !== committeeIndex) {
        return [];
      }
      return [{index: committeeIndex, slot, validators: Array.from(committee)}];
    });
  });
  return {data, executionOptimistic, finalized};
}

/** Source: unstable@ba0411b482 api/impl/beacon/state/index.ts#getStatePtc. */
export async function getStatePtc(
  this: BeaconEngineCore,
  id: ApiStateId,
  slot?: Slot
): Promise<ApiStateResult<{slot: Slot; validators: ValidatorIndex[]}>> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) return null;
  const {state, executionOptimistic, finalized} = res;
  if (!isStatePostGloas(state)) {
    return {invalid: {code: 400, message: `Cannot retrieve PTC for pre-gloas state fork=${state.forkName}`}};
  }

  const usedSlot = slot ?? state.slot;
  const epoch = computeEpochAtSlot(usedSlot);
  const stateEpoch = computeEpochAtSlot(state.slot);
  if (epoch < this.config.GLOAS_FORK_EPOCH) {
    return {invalid: {code: 400, message: `Cannot retrieve PTC for pre-gloas slot=${usedSlot}`}};
  }
  if (epoch < stateEpoch - 1 || epoch > stateEpoch + MIN_SEED_LOOKAHEAD) {
    return {invalid: {code: 400, message: `Slot ${usedSlot} is outside the PTC window of state epoch ${stateEpoch}`}};
  }

  return {
    data: {slot: usedSlot, validators: Array.from(state.getPayloadTimelinessCommittee(usedSlot))},
    executionOptimistic,
    finalized,
  };
}

export async function getEpochSyncCommittees(
  this: BeaconEngineCore,
  id: ApiStateId,
  epoch?: Epoch
): Promise<ApiStateResult<routes.beacon.EpochSyncCommitteeResponse>> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) return null;
  const {state, executionOptimistic, finalized} = res;

  const stateEpoch = computeEpochAtSlot(state.slot);
  if (stateEpoch < this.config.ALTAIR_FORK_EPOCH) {
    return {invalid: {code: 400, message: "Requested state before ALTAIR_FORK_EPOCH"}};
  }
  if (!isStatePostAltair(state)) {
    throw new Error("Expected Altair state for sync committee lookup");
  }

  const syncCommitteeCache = state.getIndexedSyncCommitteeAtEpoch(epoch ?? stateEpoch);
  const validatorIndices = new Array<ValidatorIndex>(...syncCommitteeCache.validatorIndices);
  const validatorAggregates: ValidatorIndex[][] = [];
  for (let i = 0; i < validatorIndices.length; i += SYNC_COMMITTEE_SUBNET_SIZE) {
    validatorAggregates.push(validatorIndices.slice(i, i + SYNC_COMMITTEE_SUBNET_SIZE));
  }
  return {data: {validators: validatorIndices, validatorAggregates}, executionOptimistic, finalized};
}

/** Source: unstable@2593063a82 api/impl/beacon/state/index.ts#getPendingDeposits; fork-specific SSZ stays engine-owned. */
export async function getStatePendingDeposits(
  this: BeaconEngineCore,
  id: ApiStateId,
  returnBytes: boolean
): Promise<ApiStateResultWithFork<Uint8Array | electra.PendingDeposits>> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) return null;
  const {state, executionOptimistic, finalized} = res;
  const fork = state.forkName;
  if (!isStatePostElectra(state)) {
    return {invalid: {code: 400, message: `Cannot retrieve pending deposits for pre-electra state fork=${fork}`}};
  }
  const data = returnBytes
    ? sszTypesFor(state.forkName).PendingDeposits.serialize(state.pendingDeposits)
    : state.pendingDeposits;
  return {data, fork, executionOptimistic, finalized};
}

/** Source: unstable@2593063a82 api/impl/beacon/state/index.ts#getPendingPartialWithdrawals. */
export async function getStatePendingPartialWithdrawals(
  this: BeaconEngineCore,
  id: ApiStateId,
  returnBytes: boolean
): Promise<ApiStateResultWithFork<Uint8Array | electra.PendingPartialWithdrawals>> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) return null;
  const {state, executionOptimistic, finalized} = res;
  const fork = state.forkName;
  if (!isStatePostElectra(state)) {
    return {
      invalid: {code: 400, message: `Cannot retrieve pending partial withdrawals for pre-electra state fork=${fork}`},
    };
  }
  const data = returnBytes
    ? sszTypesFor(state.forkName).PendingPartialWithdrawals.serialize(state.pendingPartialWithdrawals)
    : state.pendingPartialWithdrawals;
  return {data, fork, executionOptimistic, finalized};
}

/** Source: unstable@2593063a82 api/impl/beacon/state/index.ts#getPendingConsolidations. */
export async function getStatePendingConsolidations(
  this: BeaconEngineCore,
  id: ApiStateId,
  returnBytes: boolean
): Promise<ApiStateResultWithFork<Uint8Array | electra.PendingConsolidations>> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) return null;
  const {state, executionOptimistic, finalized} = res;
  const fork = state.forkName;
  if (!isStatePostElectra(state)) {
    return {
      invalid: {code: 400, message: `Cannot retrieve pending consolidations for pre-electra state fork=${fork}`},
    };
  }
  const data = returnBytes
    ? sszTypesFor(state.forkName).PendingConsolidations.serialize(state.pendingConsolidations)
    : state.pendingConsolidations;
  return {data, fork, executionOptimistic, finalized};
}

export async function getStateProposerLookahead(
  this: BeaconEngineCore,
  id: ApiStateId,
  returnBytes: boolean
): Promise<ApiStateResultWithFork<Uint8Array | fulu.ProposerLookahead>> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) return null;
  const {state, executionOptimistic, finalized} = res;
  const fork = state.forkName;
  if (!isStatePostFulu(state)) {
    return {invalid: {code: 400, message: `Cannot retrieve proposer lookahead for pre-fulu state fork=${fork}`}};
  }
  const data = returnBytes ? ssz.fulu.ProposerLookahead.serialize(state.proposerLookahead) : state.proposerLookahead;
  return {data, fork, executionOptimistic, finalized};
}

/** Source: unstable@ba0411b482 chain/chain.ts#getStateByStateRoot. */
async function getStateByStateRoot(
  this: BeaconEngineCore,
  stateRoot: RootHex,
  opts?: StateGetOpts
): Promise<{state: IBeaconStateView | Uint8Array; executionOptimistic: boolean; finalized: boolean} | null> {
  const finalizedBlock = this.forkChoice.getFinalizedBlock();
  const finalizedCheckpoint = this.forkChoice.getFinalizedCheckpoint();
  // Checkpoint state only equals the block post-state if the block is at the epoch start slot
  if (
    finalizedBlock.stateRoot === stateRoot &&
    finalizedBlock.slot === computeStartSlotAtEpoch(finalizedCheckpoint.epoch)
  ) {
    const state = this.regen.getCheckpointStateSync({
      epoch: finalizedCheckpoint.epoch,
      rootHex: finalizedCheckpoint.rootHex,
    });
    if (state) {
      return {
        state,
        executionOptimistic: isOptimisticBlock(finalizedBlock),
        finalized: finalizedCheckpoint.epoch !== GENESIS_EPOCH,
      };
    }
  }

  let genesisStateRoot = genesisStateRoots.get(this);
  if (genesisStateRoot === undefined) {
    const genesisBlock = await this.db.blockArchive.get(GENESIS_SLOT);
    genesisStateRoot = genesisBlock ? toRootHex(genesisBlock.message.stateRoot) : null;
    genesisStateRoots.set(this, genesisStateRoot);
  }
  if (genesisStateRoot === stateRoot) {
    const state = await this.db.stateArchive.getBinary(GENESIS_SLOT);
    if (state) {
      return {state, executionOptimistic: false, finalized: finalizedCheckpoint.epoch !== GENESIS_EPOCH};
    }
  }

  if (opts?.allowRegen) {
    const state = await this.regen.getState(stateRoot, RegenCaller.restApi);
    const block = this.forkChoice.getBlockDefaultStatus(
      ssz.phase0.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader)
    );
    const finalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;
    return {
      state,
      executionOptimistic: block != null && isOptimisticBlock(block),
      finalized: state.epoch <= finalizedEpoch && finalizedEpoch !== GENESIS_EPOCH,
    };
  }

  const cachedStateCtx = this.regen.getStateSync(stateRoot);
  if (cachedStateCtx) {
    const block = this.forkChoice.getBlockDefaultStatus(
      ssz.phase0.BeaconBlockHeader.hashTreeRoot(cachedStateCtx.latestBlockHeader)
    );
    const finalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;
    return {
      state: cachedStateCtx,
      executionOptimistic: block != null && isOptimisticBlock(block),
      finalized: cachedStateCtx.epoch <= finalizedEpoch && finalizedEpoch !== GENESIS_EPOCH,
    };
  }

  const data = await this.getSerializedStateByRoot(fromHex(stateRoot));
  return data && {state: data, executionOptimistic: false, finalized: true};
}

async function getStateOrBytesByCheckpoint(
  this: BeaconEngineCore,
  checkpoint: CheckpointWithHex
): Promise<{state: IBeaconStateView | Uint8Array; executionOptimistic: boolean; finalized: boolean} | null> {
  const checkpointHex = {epoch: checkpoint.epoch, rootHex: checkpoint.rootHex};
  const cachedStateCtx = await this.regen.getCheckpointStateOrBytes(checkpointHex);
  if (cachedStateCtx) {
    const block = this.forkChoice.getBlockDefaultStatus(checkpoint.root);
    const finalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;
    return {
      state: cachedStateCtx,
      executionOptimistic: block != null && isOptimisticBlock(block),
      finalized: checkpoint.epoch <= finalizedEpoch && finalizedEpoch !== GENESIS_EPOCH,
    };
  }

  return null;
}

async function getStateBySlot(
  this: BeaconEngineCore,
  slot: Slot,
  opts?: StateGetOpts
): Promise<{state: IBeaconStateView; executionOptimistic: boolean; finalized: boolean} | null> {
  const finalizedBlock = this.forkChoice.getFinalizedBlock();

  if (slot < finalizedBlock.slot) {
    // request for finalized state not supported here; caller falls back to getHistoricalStateBySlot
    return null;
  }

  if (opts?.allowRegen) {
    const block = this.forkChoice.getCanonicalBlockClosestLteSlot(slot) ?? finalizedBlock;
    const state = await this.regen.getBlockSlotState(block, slot, {dontTransferCache: true}, RegenCaller.restApi);
    return {
      state,
      executionOptimistic: isOptimisticBlock(block),
      finalized: slot === finalizedBlock.slot && finalizedBlock.slot !== GENESIS_SLOT,
    };
  }

  const block = this.forkChoice.getCanonicalBlockAtSlot(slot);
  if (!block) {
    return null;
  }

  const state = this.regen.getStateSync(block.stateRoot);
  return (
    state && {
      state,
      executionOptimistic: isOptimisticBlock(block),
      finalized: slot === finalizedBlock.slot && finalizedBlock.slot !== GENESIS_SLOT,
    }
  );
}

export async function getBuilderPendingPayments(
  this: BeaconEngineCore,
  id: ApiStateId,
  returnBytes: boolean
): Promise<ApiStateResultWithFork<Uint8Array | gloas.BuilderPendingPayments>> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) return null;
  const {state, executionOptimistic, finalized} = res;
  const fork = state.forkName;

  if (!isStatePostGloas(state)) {
    return {
      invalid: {code: 400, message: `Cannot retrieve pending builder payments for pre-gloas state fork=${fork}`},
    };
  }

  const builderPendingPayments = state.builderPendingPayments;

  return {
    data: returnBytes ? ssz.gloas.BuilderPendingPayments.serialize(builderPendingPayments) : builderPendingPayments,
    executionOptimistic,
    finalized,
    fork,
  };
}

export async function getBuilderPendingWithdrawals(
  this: BeaconEngineCore,
  id: ApiStateId,
  returnBytes: boolean
): Promise<ApiStateResultWithFork<Uint8Array | gloas.BuilderPendingWithdrawals>> {
  const res = await resolveStateViewForApi.call(this, id);
  if (!res) return null;
  const {state, executionOptimistic, finalized} = res;
  const fork = state.forkName;

  if (!isStatePostGloas(state)) {
    return {
      invalid: {code: 400, message: `Cannot retrieve pending builder withdrawals for pre-gloas state fork=${fork}`},
    };
  }

  const builderPendingWithdrawals = state.builderPendingWithdrawals;

  return {
    data: returnBytes
      ? ssz.gloas.BuilderPendingWithdrawals.serialize(builderPendingWithdrawals)
      : builderPendingWithdrawals,
    executionOptimistic,
    finalized,
    fork,
  };
}

export type StateValidatorIndexResponse =
  | {valid: true; validatorIndex: ValidatorIndex}
  | {valid: false; code: number; reason: string};

/** Resolve a validator id (index | index-string | pubkey hex | pubkey bytes) to its index in `state`. */
export function getStateValidatorIndex(
  id: routes.beacon.ValidatorId | BLSPubkey,
  state: IBeaconStateView,
  pubkeyCache: PubkeyCache
): StateValidatorIndexResponse {
  if (typeof id === "string") {
    if (id.startsWith("0x")) {
      try {
        id = fromHex(id);
      } catch (_e) {
        return {valid: false, code: 400, reason: "Invalid pubkey hex encoding"};
      }
    } else {
      id = Number(id);
    }
  }

  if (typeof id === "number") {
    const validatorIndex = id;
    if (!Number.isSafeInteger(validatorIndex) || validatorIndex < 0) {
      return {valid: false, code: 400, reason: "Invalid validator index"};
    }
    if (validatorIndex >= state.validatorCount) {
      return {valid: false, code: 404, reason: "Validator index from future state"};
    }
    return {valid: true, validatorIndex};
  }

  const validatorIndex = pubkeyCache.getIndex(id);
  if (validatorIndex === null) {
    return {valid: false, code: 404, reason: "Validator pubkey not found in state"};
  }
  if (validatorIndex >= state.validatorCount) {
    return {valid: false, code: 404, reason: "Validator pubkey from future state"};
  }
  return {valid: true, validatorIndex};
}

export function getStateBuilderIndex(
  id: routes.beacon.BuilderId | BLSPubkey,
  state: IBeaconStateViewGloas
): {valid: true; builderIndex: BuilderIndex} | {valid: false; code: number; reason: string} {
  if (typeof id === "string") {
    // mutate `id` and fallthrough to below
    if (id.startsWith("0x")) {
      try {
        id = fromHex(id);
      } catch (_e) {
        return {valid: false, code: 400, reason: "Invalid pubkey hex encoding"};
      }
    } else {
      id = Number(id);
    }
  }

  if (typeof id === "number") {
    const builderIndex = id;
    // builder is invalid or added later than given stateId
    if (!Number.isSafeInteger(builderIndex) || builderIndex < 0) {
      return {valid: false, code: 400, reason: "Invalid builder index"};
    }
    if (builderIndex >= state.getBuildersLength()) {
      return {valid: false, code: 404, reason: "Builder index from future state"};
    }
    return {valid: true, builderIndex};
  }

  // typeof id === Uint8Array
  // There is no builder pubkey cache, linear scan over the registry
  const buildersLength = state.getBuildersLength();
  for (let builderIndex = 0; builderIndex < buildersLength; builderIndex++) {
    if (byteArrayEquals(state.getBuilder(builderIndex).pubkey, id)) {
      return {valid: true, builderIndex};
    }
  }
  return {valid: false, code: 404, reason: "Builder pubkey not found in state"};
}
