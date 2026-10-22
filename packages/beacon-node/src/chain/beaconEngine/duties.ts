import {routes} from "@lodestar/api";
import {ExecutionStatus, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {
  ForkName,
  GENESIS_SLOT,
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT,
  isForkPostElectra,
  isForkPostGloas,
} from "@lodestar/params";
import {
  DataAvailabilityStatus,
  IBeaconStateView,
  calculateCommitteeAssignments,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  isStatePostAltair,
  isStatePostGloas,
  proposerShufflingDecisionRoot,
} from "@lodestar/state-transition";
import {
  BLSPubkey,
  CommitteeIndex,
  Epoch,
  Root,
  Slot,
  SubcommitteeIndex,
  ValidatorIndex,
  phase0,
  ssz,
} from "@lodestar/types";
import {fromHex, sleep, toRootHex} from "@lodestar/utils";
import {ApiError} from "../../api/impl/errors.js";
import {ZERO_HASH} from "../../constants/index.js";
import {RegenCaller} from "../regen/index.js";
import {CheckpointHex} from "../stateCache/types.js";
import type {BeaconEngineCore} from "./beaconEngineCore.js";
import {BeaconEngineEvent} from "./events.js";
import {BeaconEngineErrorCode, ProductionError, ProductionResponse} from "./interface.js";

type GetHeadStateAtEpoch = (epoch: Epoch, regenCaller: RegenCaller) => Promise<IBeaconStateView>;

const genesisBlockRoots = new WeakMap<BeaconEngineCore, Root>();

/**
 * Proposer duties for `epoch`.
 * Source: unstable@551b8b0a3d packages/beacon-node/src/api/impl/validator/index.ts#getProposerDuties.
 * [beacon-engine] deviation: request checks, clock timing and response metadata remain in the API;
 * state resolution runs in the engine. Historical proposer duties are not supported here.
 */
export async function getProposerDuties(
  this: BeaconEngineCore,
  epoch: Epoch,
  {currentEpoch, checkpointWaitTimeoutMs}: {currentEpoch: Epoch; checkpointWaitTimeoutMs?: number},
  v2: boolean,
  getHeadStateAtEpoch: GetHeadStateAtEpoch
): Promise<{data: routes.validator.ProposerDuty[]; dependentRoot: Root; head: ProtoBlock}> {
  const startSlot = computeStartSlotAtEpoch(epoch);
  const head = this.forkChoice.getHead();

  let state: IBeaconStateView | undefined;
  if (checkpointWaitTimeoutMs !== undefined) {
    const cpState = await waitForCheckpointState.call(
      this,
      {rootHex: head.blockRoot, epoch: currentEpoch + 1},
      checkpointWaitTimeoutMs
    );
    if (cpState) {
      state = cpState;
      this.metrics?.duties.requestNextEpochProposalDutiesHit.inc();
    } else {
      this.metrics?.duties.requestNextEpochProposalDutiesMiss.inc();
    }
  }
  if (!state) {
    if (epoch >= currentEpoch - 1) {
      // TODO - beacon engine: not sure if we need to do this, just conform to the current unstable behavior for now
      state = await getHeadStateAtEpoch(currentEpoch, RegenCaller.getDuties);
    } else {
      // TODO - beacon engine: currently unstable call getStateResponseWithRegen()
      // the engine (Phase 5). Throw for now; serve it here once the engine owns the archive.
      throw Error(`Proposer duties for past epoch ${epoch} not supported yet (engine has no archive access)`);
    }
  }

  const stateEpoch = state.epoch;
  let indexes: ValidatorIndex[];
  switch (epoch) {
    case stateEpoch:
      indexes = state.currentProposers;
      break;

    case stateEpoch + 1:
      // make sure shuffling is calculated and ready for the call to calculate nextProposers
      await this.shufflingCache.get(stateEpoch + 1, state.nextDecisionRoot);
      indexes = state.nextProposers;
      break;

    case stateEpoch - 1: {
      const indexesPrevEpoch = state.previousProposers;
      if (indexesPrevEpoch === null) {
        // Should not happen as previous proposer duties should be initialized for head state
        throw Error(`Proposer duties for previous epoch ${epoch} not yet initialized`);
      }
      indexes = indexesPrevEpoch;
      break;
    }

    default:
      throw Error(`Proposer duties for epoch ${epoch} not supported, current epoch ${stateEpoch}`);
  }

  const pubkeys = getPubkeysForIndices(state, indexes);
  const data: routes.validator.ProposerDuty[] = [];
  for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
    data.push({slot: startSlot + i, validatorIndex: indexes[i], pubkey: pubkeys[i]});
  }

  // In v2 the dependent root is different after fulu due to deterministic proposer lookahead
  let dependentRoot = proposerShufflingDecisionRoot(
    v2 ? this.config.getForkName(startSlot) : ForkName.phase0,
    state,
    epoch
  );
  const logCtx = {epoch, stateSlot: state.slot, stateEpoch, v2};
  if (dependentRoot === null) {
    // fallback to get_proposer_duties() v1, also in lodestar v1.43
    this.logger.verbose("Proposer duties decision root not in state, falling back to state epoch", logCtx);
    dependentRoot = proposerShufflingDecisionRoot(ForkName.phase0, state, stateEpoch);
  }
  if (dependentRoot === null) {
    this.logger.verbose("Proposer duties decision root not in state, falling back to genesis block root", logCtx);
    dependentRoot = genesisBlockRoot.call(this, state);
  }
  this.logger.verbose("Computed proposer duties decision root", {...logCtx, dependentRoot: toRootHex(dependentRoot)});

  return {data, dependentRoot, head};
}

/**
 * Attester duties for `validatorIndices` at `epoch`.
 * Source: unstable@551b8b0a3d packages/beacon-node/src/api/impl/validator/index.ts#getAttesterDuties.
 * [beacon-engine] deviation: request checks, epoch waiting and response metadata remain in the API;
 * the engine resolves state at the supplied currentEpoch and returns the head for API metadata.
 */
export async function getAttesterDuties(
  this: BeaconEngineCore,
  epoch: Epoch,
  indices: ValidatorIndex[],
  currentEpoch: Epoch,
  getHeadStateAtEpoch: GetHeadStateAtEpoch
): Promise<{data: routes.validator.AttesterDuty[]; dependentRoot: Root; head: ProtoBlock}> {
  const head = this.forkChoice.getHead();
  const state = await getHeadStateAtEpoch(currentEpoch, RegenCaller.getDuties);

  // Check that all validatorIndex belong to the state before calling getCommitteeAssignments()
  const pubkeys = getPubkeysForIndices(state, indices);
  const decisionRoot = state.getShufflingDecisionRoot(epoch);
  const shuffling = await this.shufflingCache.get(epoch, decisionRoot);
  if (!shuffling) {
    throw Error(
      `No shuffling found to calculate committee assignments for epoch: ${epoch} and decisionRoot: ${decisionRoot}`
    );
  }
  const committeeAssignments = calculateCommitteeAssignments(shuffling, indices);
  const data: routes.validator.AttesterDuty[] = [];
  for (let i = 0, len = indices.length; i < len; i++) {
    const validatorIndex = indices[i];
    const duty = committeeAssignments.get(validatorIndex) as routes.validator.AttesterDuty | undefined;
    if (duty) {
      // Mutate existing object instead of re-creating another new object with spread operator
      // Should be faster and require less memory
      duty.pubkey = pubkeys[i];
      data.push(duty);
    }
  }

  const dependentRoot = fromHex(state.getShufflingDecisionRoot(epoch)) || genesisBlockRoot.call(this, state);
  return {data, dependentRoot, head};
}

/**
 * Sync committee duties for `validatorIndices` at `epoch`.
 * Source: unstable@551b8b0a3d packages/beacon-node/src/api/impl/validator/index.ts#getSyncCommitteeDuties.
 * [beacon-engine] deviation: request checks, epoch waiting and response metadata remain in the API;
 * this engine implementation reads the head state synchronously and returns the head for API metadata.
 */
export function getSyncCommitteeDuties(
  this: BeaconEngineCore,
  epoch: Epoch,
  indices: ValidatorIndex[]
): {data: routes.validator.SyncDuty[]; head: ProtoBlock} {
  const head = this.forkChoice.getHead();
  const state = this.getHeadState();
  if (!isStatePostAltair(state)) {
    throw Error("Sync committee duties are not available before Altair");
  }

  // Check that all validatorIndex belong to the state before calling getCommitteeAssignments()
  const pubkeys = getPubkeysForIndices(state, indices);
  // Ensures `epoch // EPOCHS_PER_SYNC_COMMITTEE_PERIOD <= current_epoch // EPOCHS_PER_SYNC_COMMITTEE_PERIOD + 1`
  const validatorSyncCommitteeIndexMap = state.getIndexedSyncCommitteeAtEpoch(epoch).validatorIndexMap;

  const data: routes.validator.SyncDuty[] = [];
  for (let i = 0, len = indices.length; i < len; i++) {
    const validatorIndex = indices[i];
    const validatorSyncCommitteeIndices = validatorSyncCommitteeIndexMap.get(validatorIndex);
    if (validatorSyncCommitteeIndices) {
      data.push({pubkey: pubkeys[i], validatorIndex, validatorSyncCommitteeIndices});
    }
  }

  return {data, head};
}

/**
 * Gloas PTC duties for `validatorIndices` at `epoch`.
 * Source: unstable@551b8b0a3d packages/beacon-node/src/api/impl/validator/index.ts#getPtcDuties.
 * [beacon-engine] deviation: request checks, epoch waiting and response metadata remain in the API;
 * the engine resolves state at the supplied currentEpoch and returns the head for API metadata.
 */
export async function getPtcDuties(
  this: BeaconEngineCore,
  epoch: Epoch,
  indices: ValidatorIndex[],
  currentEpoch: Epoch,
  getHeadStateAtEpoch: GetHeadStateAtEpoch
): Promise<{data: routes.validator.PtcDuty[]; dependentRoot: Root; head: ProtoBlock}> {
  const startSlot = computeStartSlotAtEpoch(epoch);
  const head = this.forkChoice.getHead();
  const state = await getHeadStateAtEpoch(currentEpoch, RegenCaller.getDuties);
  if (!isStatePostGloas(state)) {
    throw Error("PTC duties are not available before Gloas");
  }

  const pubkeys = getPubkeysForIndices(state, indices);
  const ptcs = state.getEpochPTCs(epoch);
  const data: routes.validator.PtcDuty[] = [];
  for (let i = 0, len = indices.length; i < len; i++) {
    const validatorIndex = indices[i];
    for (let j = 0; j < SLOTS_PER_EPOCH; j++) {
      if (ptcs[j].indexOf(validatorIndex) !== -1) {
        data.push({pubkey: pubkeys[i], validatorIndex, slot: j + startSlot});
        break;
      }
    }
  }

  const dependentRoot = fromHex(state.getShufflingDecisionRoot(epoch)) || genesisBlockRoot.call(this, state);
  return {data, dependentRoot, head};
}

/**
 * Wait for the next-epoch checkpoint state so upcoming proposer duties can be served early.
 * Source: unstable@551b8b0a3d packages/beacon-node/src/api/impl/validator/index.ts#waitForCheckpointState.
 * [beacon-engine] deviation: the API supplies timeoutMs; use a relative timer instead of the upstream
 * chain.clock.waitForSlot(epochStartSlot + 1) deadline.
 */
async function waitForCheckpointState(
  this: BeaconEngineCore,
  cpHex: CheckpointHex,
  timeoutMs: number
): Promise<IBeaconStateView | null> {
  const cpState = this.regen.getCheckpointStateSync(cpHex);
  if (cpState) {
    return cpState;
  }
  const cp = {epoch: cpHex.epoch, root: fromHex(cpHex.rootHex)};
  // if not, wait for a checkpoint event until the relative timeout elapses
  let listener: ((eventCp: phase0.Checkpoint) => void) | null = null;
  const foundCPState = await Promise.race([
    new Promise((resolve) => {
      listener = (eventCp) => {
        resolve(ssz.phase0.Checkpoint.equals(eventCp, cp));
      };
      this.emitter.once(BeaconEngineEvent.checkpoint, listener);
    }),
    sleep(timeoutMs),
  ]);

  if (listener != null) {
    this.emitter.off(BeaconEngineEvent.checkpoint, listener);
  }

  if (foundCPState === true) {
    return this.regen.getCheckpointStateSync(cpHex);
  }

  return null;
}

/**
 * Compute and cache the genesis block root for the duty dependent-root fallback.
 * Source: unstable@551b8b0a3d packages/beacon-node/src/api/impl/validator/index.ts#getGenesisBlockRoot.
 * [beacon-engine] deviation: synchronous state-only lookup with a module-private cache per engine;
 * omit the upstream canonical-block DB lookup and retain the ZERO_HASH fallback when unavailable.
 */
function genesisBlockRoot(this: BeaconEngineCore, state: IBeaconStateView): Root {
  let root = genesisBlockRoots.get(this);
  if (!root) {
    // Close to genesis the genesis block may not be available in the DB
    if (state.slot === GENESIS_SLOT) {
      root = state.computeAnchorCheckpoint().checkpoint.root;
    } else if (state.slot < SLOTS_PER_HISTORICAL_ROOT) {
      root = state.getBlockRootAtSlot(GENESIS_SLOT);
    }
    if (root) {
      genesisBlockRoots.set(this, root);
    }
  }
  return root || ZERO_HASH;
}

/**
 * Precompute all pubkeys for given `validatorIndices`. Ensures that all `validatorIndices` are known
 * before doing other expensive logic.
 * Source: unstable@551b8b0a3d packages/beacon-node/src/api/impl/validator/utils.ts#getPubkeysForIndices.
 *
 * Uses special BranchNodeStruct state.validators data structure to optimize getting pubkeys.
 * Type-unsafe: assumes state.validators[i] is of BranchNodeStruct type.
 * Note: This is the fastest way of getting compressed pubkeys.
 *       See benchmark -> packages/beacon-node/test/perf/api/impl/validator/attester.test.ts
 */
export function getPubkeysForIndices(state: IBeaconStateView, indexes: ValidatorIndex[]): BLSPubkey[] {
  const validatorsLen = state.validatorCount; // Get once, it's expensive

  const pubkeys: BLSPubkey[] = [];
  for (let i = 0, len = indexes.length; i < len; i++) {
    const index = indexes[i];
    if (index >= validatorsLen) {
      throw Error(`validatorIndex ${index} too high. Current validator count ${validatorsLen}`);
    }

    // NOTE: This could be optimized further by traversing the tree optimally with .getNodes()
    const validator = state.getValidator(index);
    pubkeys.push(validator.pubkey);
  }

  return pubkeys;
}

/** Source: unstable@9cb14e3381 api/impl/validator/index.ts#produceAttestationData. */
export async function produceAttestationData(
  this: BeaconEngineCore,
  slot: Slot,
  committeeIndex: CommitteeIndex | undefined,
  getHeadStateAtEpoch: GetHeadStateAtEpoch
): Promise<ProductionResponse<phase0.AttestationData>> {
  // This needs a state in the same epoch as `slot` such that state.currentJustifiedCheckpoint is correct.
  // Note: This may trigger an epoch transition if there skipped slots at the beginning of the epoch.
  const head = this.forkChoice.getHead();
  const headSlot = head.slot;
  const attEpoch = computeEpochAtSlot(slot);
  const headBlockRoot = fromHex(head.blockRoot);
  const fork = this.config.getForkName(slot);

  // Canonical block root ≤ slot (matches the former state.getBlockRootAtSlot; handles skipped slots).
  const blockRootAtSlot = (atSlot: Slot): Root => {
    const canonical = this.forkChoice.getCanonicalBlockClosestLteSlot(atSlot);
    if (!canonical) {
      throw Error(`No canonical block found for slot=${atSlot}`);
    }
    return fromHex(canonical.blockRoot);
  };

  const beaconBlockRoot =
    slot >= headSlot
      ? // When attesting to the head slot or later, always use the head of the chain.
        headBlockRoot
      : // Permit attesting to slots *prior* to the current head. This is desirable when
        // the VC and BN are out-of-sync due to time issues or overloading.
        blockRootAtSlot(slot);

  let index: CommitteeIndex;
  if (isForkPostGloas(fork)) {
    const canonicalBlock = this.forkChoice.getCanonicalBlockByRoot(beaconBlockRoot);
    if (!canonicalBlock) {
      // This should never happen
      throw Error(`Block not found in fork choice for slot=${slot}, root=${toRootHex(beaconBlockRoot)}`);
    }
    // After Gloas, attestation.data.index signals payload status in fork-choice:
    // - 0 = EMPTY / not present, 1 = FULL / present
    // - same-slot attestations must always use index = 0
    if (canonicalBlock.slot !== slot) {
      index = canonicalBlock.payloadStatus === PayloadStatus.FULL ? 1 : 0;
    } else {
      index = 0;
    }
  } else if (isForkPostElectra(fork)) {
    index = 0;
  } else {
    if (committeeIndex === undefined) {
      throw new ApiError(400, `Committee index must be provided for pre-electra fork=${fork}`);
    }
    index = committeeIndex;
  }

  const targetSlot = computeStartSlotAtEpoch(attEpoch);
  const targetRoot =
    targetSlot >= headSlot
      ? // If the state is earlier than the target slot then the target *must* be the head block root.
        headBlockRoot
      : blockRootAtSlot(targetSlot);

  // Check the execution status as validator shouldn't vote on an optimistic head
  // Check on target is sufficient as a valid target would imply a valid source
  const error = getValidatorBlockError.call(this, targetRoot);
  if (error) return error;

  // To get the correct source we must get a state in the same epoch as the attestation's epoch.
  // Use the state's realized checkpoint; fork choice may already have pulled up its justified checkpoint.
  const state = await getHeadStateAtEpoch(attEpoch, RegenCaller.produceAttestationData);
  const source = state.currentJustifiedCheckpoint;

  return {
    ok: true,
    data: {
      slot,
      index,
      beaconBlockRoot,
      source,
      target: {epoch: attEpoch, root: targetRoot},
    },
  };
}

export function produceSyncCommitteeContribution(
  this: BeaconEngineCore,
  subnet: SubcommitteeIndex,
  slot: Slot,
  blockRoot: Root
): ProductionResponse<Uint8Array | null> {
  const error = getValidatorBlockError.call(this, blockRoot);
  if (error) return error;
  const contribution = this.syncCommitteeMessagePool.getContribution(subnet, slot, blockRoot);
  return {ok: true, data: contribution ? ssz.altair.SyncCommitteeContribution.serialize(contribution) : null};
}

function getValidatorBlockError(this: BeaconEngineCore, blockRoot: Root): ProductionError | null {
  const block = this.forkChoice.getBlockDefaultStatus(blockRoot);
  if (!block) {
    return {
      ok: false,
      code: BeaconEngineErrorCode.API_ERROR,
      payload: {status: 404, message: `Block not in forkChoice, beaconBlockRoot=${toRootHex(blockRoot)}`},
    };
  }
  if (block.executionStatus === ExecutionStatus.Syncing) {
    return {
      ok: false,
      code: BeaconEngineErrorCode.NODE_SYNCING,
      payload: {
        message: `Block's execution payload not yet validated, executionPayloadBlockHash=${block.executionPayloadBlockHash} number=${"executionPayloadNumber" in block ? block.executionPayloadNumber : undefined}`,
      },
    };
  }
  if (block.dataAvailabilityStatus === DataAvailabilityStatus.OutOfRange) {
    return {
      ok: false,
      code: BeaconEngineErrorCode.NODE_SYNCING,
      payload: {message: "Block's data is out of range and not validated"},
    };
  }
  return null;
}
