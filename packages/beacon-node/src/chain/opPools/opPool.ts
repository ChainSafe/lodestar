import {fromHexString, toHexString} from "@chainsafe/ssz";
import {
  CachedBeaconStateAllForks,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getAttesterSlashableIndices,
  isValidVoluntaryExit,
} from "@lodestar/state-transition";
import {Repository, Id} from "@lodestar/db";
import {
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS,
  MAX_BLS_TO_EXECUTION_CHANGES,
  BLS_WITHDRAWAL_PREFIX,
  MAX_ATTESTER_SLASHINGS,
  ForkSeq,
} from "@lodestar/params";
import {Epoch, phase0, capella, ssz, ValidatorIndex, allForks} from "@lodestar/types";
import {IBeaconDb} from "../../db/index.js";
import {SignedBLSToExecutionChangeVersioned} from "../../util/types.js";
import {BlockType} from "../interface.js";
import {Metrics} from "../../metrics/metrics.js";
import {BlockProductionStep} from "../produceBlock/produceBlockBody.js";
import {isValidBlsToExecutionChangeForBlockInclusion} from "./utils.js";

type HexRoot = string;
type AttesterSlashingCached = {
  attesterSlashing: phase0.AttesterSlashing;
  intersectingIndices: number[];
};

export class OpPool {
  /** Map of uniqueId(AttesterSlashing) -> AttesterSlashing */
  private readonly attesterSlashings = new Map<HexRoot, AttesterSlashingCached>();
  /** Map of to slash validator index -> ProposerSlashing */
  private readonly proposerSlashings = new Map<ValidatorIndex, phase0.ProposerSlashing>();
  /** Map of to exit validator index -> SignedVoluntaryExit */
  private readonly voluntaryExits = new Map<ValidatorIndex, phase0.SignedVoluntaryExit>();
  /** Set of seen attester slashing indexes. No need to prune */
  private readonly attesterSlashingIndexes = new Set<ValidatorIndex>();
  /** Map of validator index -> SignedBLSToExecutionChange */
  private readonly blsToExecutionChanges = new Map<ValidatorIndex, SignedBLSToExecutionChangeVersioned>();

  // Getters for metrics

  get attesterSlashingsSize(): number {
    return this.attesterSlashings.size;
  }
  get proposerSlashingsSize(): number {
    return this.proposerSlashings.size;
  }
  get voluntaryExitsSize(): number {
    return this.voluntaryExits.size;
  }
  get blsToExecutionChangeSize(): number {
    return this.blsToExecutionChanges.size;
  }

  async fromPersisted(db: IBeaconDb): Promise<void> {
    const [attesterSlashings, proposerSlashings, voluntaryExits, blsToExecutionChanges] = await Promise.all([
      db.attesterSlashing.entries(),
      db.proposerSlashing.values(),
      db.voluntaryExit.values(),
      db.blsToExecutionChange.values(),
    ]);

    for (const attesterSlashing of attesterSlashings) {
      this.insertAttesterSlashing(attesterSlashing.value, attesterSlashing.key);
    }
    for (const proposerSlashing of proposerSlashings) {
      this.insertProposerSlashing(proposerSlashing);
    }
    for (const voluntaryExit of voluntaryExits) {
      this.insertVoluntaryExit(voluntaryExit);
    }
    for (const item of blsToExecutionChanges) {
      this.insertBlsToExecutionChange(item.data, item.preCapella);
    }
  }

  async toPersisted(db: IBeaconDb): Promise<void> {
    await Promise.all([
      persistDiff(
        db.attesterSlashing,
        Array.from(this.attesterSlashings.entries()).map(([key, value]) => ({
          key: fromHexString(key),
          value: value.attesterSlashing,
        })),
        toHexString
      ),
      persistDiff(
        db.proposerSlashing,
        Array.from(this.proposerSlashings.entries()).map(([key, value]) => ({key, value})),
        (index) => index
      ),
      persistDiff(
        db.voluntaryExit,
        Array.from(this.voluntaryExits.entries()).map(([key, value]) => ({key, value})),
        (index) => index
      ),
      persistDiff(
        db.blsToExecutionChange,
        Array.from(this.blsToExecutionChanges.entries()).map(([key, value]) => ({key, value})),
        (index) => index
      ),
    ]);
  }

  // Use the opPool as seen cache for gossip validation

  /** Returns false if at least one intersecting index has not been seen yet */
  hasSeenAttesterSlashing(intersectingIndices: ValidatorIndex[]): boolean {
    for (const validatorIndex of intersectingIndices) {
      if (!this.attesterSlashingIndexes.has(validatorIndex)) {
        return false;
      }
    }
    return true;
  }

  hasSeenVoluntaryExit(validatorIndex: ValidatorIndex): boolean {
    return this.voluntaryExits.has(validatorIndex);
  }

  hasSeenBlsToExecutionChange(validatorIndex: ValidatorIndex): boolean {
    return this.blsToExecutionChanges.has(validatorIndex);
  }

  hasSeenProposerSlashing(validatorIndex: ValidatorIndex): boolean {
    return this.proposerSlashings.has(validatorIndex);
  }

  /** Must be validated beforehand */
  insertAttesterSlashing(attesterSlashing: phase0.AttesterSlashing, rootHash?: Uint8Array): void {
    if (!rootHash) rootHash = ssz.phase0.AttesterSlashing.hashTreeRoot(attesterSlashing);
    // TODO: Do once and cache attached to the AttesterSlashing object
    const intersectingIndices = getAttesterSlashableIndices(attesterSlashing);
    this.attesterSlashings.set(toHexString(rootHash), {
      attesterSlashing,
      intersectingIndices,
    });
    for (const index of intersectingIndices) {
      this.attesterSlashingIndexes.add(index);
    }
  }

  /** Must be validated beforehand */
  insertProposerSlashing(proposerSlashing: phase0.ProposerSlashing): void {
    this.proposerSlashings.set(proposerSlashing.signedHeader1.message.proposerIndex, proposerSlashing);
  }

  /** Must be validated beforehand */
  insertVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): void {
    this.voluntaryExits.set(voluntaryExit.message.validatorIndex, voluntaryExit);
  }

  /** Must be validated beforehand */
  insertBlsToExecutionChange(blsToExecutionChange: capella.SignedBLSToExecutionChange, preCapella = false): void {
    this.blsToExecutionChanges.set(blsToExecutionChange.message.validatorIndex, {
      data: blsToExecutionChange,
      preCapella,
    });
  }

  /**
   * Get proposer and attester slashings and voluntary exits and bls to execution change for inclusion in a block.
   *
   * This function computes both types of slashings and exits, because attester slashings and exits may be invalidated by
   * slashings included earlier in the block.
   */
  getSlashingsAndExits(
    state: CachedBeaconStateAllForks,
    blockType: BlockType,
    metrics: Metrics | null
  ): [
    phase0.AttesterSlashing[],
    phase0.ProposerSlashing[],
    phase0.SignedVoluntaryExit[],
    capella.SignedBLSToExecutionChange[],
  ] {
    const {config} = state;
    const stateEpoch = computeEpochAtSlot(state.slot);
    const stateFork = config.getForkName(state.slot);
    const toBeSlashedIndices = new Set<ValidatorIndex>();
    const proposerSlashings: phase0.ProposerSlashing[] = [];

    const stepsMetrics =
      blockType === BlockType.Full
        ? metrics?.executionBlockProductionTimeSteps
        : metrics?.builderBlockProductionTimeSteps;

    const endProposerSlashing = stepsMetrics?.startTimer();
    for (const proposerSlashing of this.proposerSlashings.values()) {
      const index = proposerSlashing.signedHeader1.message.proposerIndex;
      const validator = state.validators.getReadonly(index);
      if (!validator.slashed && validator.activationEpoch <= stateEpoch && stateEpoch < validator.withdrawableEpoch) {
        proposerSlashings.push(proposerSlashing);
        // Set of validators to be slashed, so we don't attempt to construct invalid attester slashings.
        toBeSlashedIndices.add(index);
        if (proposerSlashings.length >= MAX_PROPOSER_SLASHINGS) {
          break;
        }
      }
    }
    endProposerSlashing?.({
      step: BlockProductionStep.proposerSlashing,
    });

    const endAttesterSlashings = stepsMetrics?.startTimer();
    const attesterSlashings: phase0.AttesterSlashing[] = [];
    attesterSlashing: for (const attesterSlashing of this.attesterSlashings.values()) {
      /** Indices slashable in this attester slashing */
      const slashableIndices = new Set<ValidatorIndex>();
      for (let i = 0; i < attesterSlashing.intersectingIndices.length; i++) {
        const index = attesterSlashing.intersectingIndices[i];
        // If we already have a slashing for this index, we can continue on to the next slashing
        if (toBeSlashedIndices.has(index)) {
          continue attesterSlashing;
        }

        const validator = state.validators.getReadonly(index);
        if (isSlashableAtEpoch(validator, stateEpoch)) {
          slashableIndices.add(index);
        }
        if (attesterSlashings.length >= MAX_ATTESTER_SLASHINGS) {
          break attesterSlashing;
        }
      }

      // If there were slashable indices in this slashing
      // Then include the slashing and count the slashable indices
      if (slashableIndices.size > 0) {
        attesterSlashings.push(attesterSlashing.attesterSlashing);
        for (const index of slashableIndices) {
          toBeSlashedIndices.add(index);
        }
      }
    }
    endAttesterSlashings?.({
      step: BlockProductionStep.attesterSlashings,
    });

    const endVoluntaryExits = stepsMetrics?.startTimer();
    const voluntaryExits: phase0.SignedVoluntaryExit[] = [];
    for (const voluntaryExit of this.voluntaryExits.values()) {
      if (
        !toBeSlashedIndices.has(voluntaryExit.message.validatorIndex) &&
        isValidVoluntaryExit(state, voluntaryExit, false) &&
        // Signature validation is skipped in `isValidVoluntaryExit(,,false)` since it was already validated in gossip
        // However we must make sure that the signature fork is the same, or it will become invalid if included through
        // a future fork.
        stateFork === config.getForkName(computeStartSlotAtEpoch(voluntaryExit.message.epoch))
      ) {
        voluntaryExits.push(voluntaryExit);
        if (voluntaryExits.length >= MAX_VOLUNTARY_EXITS) {
          break;
        }
      }
    }
    endVoluntaryExits?.({
      step: BlockProductionStep.voluntaryExits,
    });

    const endBlsToExecutionChanges = stepsMetrics?.startTimer();
    const blsToExecutionChanges: capella.SignedBLSToExecutionChange[] = [];
    for (const blsToExecutionChange of this.blsToExecutionChanges.values()) {
      if (isValidBlsToExecutionChangeForBlockInclusion(state, blsToExecutionChange.data)) {
        blsToExecutionChanges.push(blsToExecutionChange.data);
        if (blsToExecutionChanges.length >= MAX_BLS_TO_EXECUTION_CHANGES) {
          break;
        }
      }
    }
    endBlsToExecutionChanges?.({
      step: BlockProductionStep.blsToExecutionChanges,
    });

    return [attesterSlashings, proposerSlashings, voluntaryExits, blsToExecutionChanges];
  }

  /** For beacon pool API */
  getAllAttesterSlashings(): phase0.AttesterSlashing[] {
    return Array.from(this.attesterSlashings.values()).map((attesterSlashings) => attesterSlashings.attesterSlashing);
  }

  /** For beacon pool API */
  getAllProposerSlashings(): phase0.ProposerSlashing[] {
    return Array.from(this.proposerSlashings.values());
  }

  /** For beacon pool API */
  getAllVoluntaryExits(): phase0.SignedVoluntaryExit[] {
    return Array.from(this.voluntaryExits.values());
  }

  /** For beacon pool API */
  getAllBlsToExecutionChanges(): SignedBLSToExecutionChangeVersioned[] {
    return Array.from(this.blsToExecutionChanges.values());
  }

  /**
   * Prune all types of transactions given the latest head state
   */
  pruneAll(headBlock: allForks.SignedBeaconBlock, headState: CachedBeaconStateAllForks): void {
    this.pruneAttesterSlashings(headState);
    this.pruneProposerSlashings(headState);
    this.pruneVoluntaryExits(headState);
    this.pruneBlsToExecutionChanges(headBlock, headState);
  }

  /**
   * Prune attester slashings for all slashed or withdrawn validators.
   */
  private pruneAttesterSlashings(headState: CachedBeaconStateAllForks): void {
    const finalizedEpoch = headState.finalizedCheckpoint.epoch;
    attesterSlashing: for (const [key, attesterSlashing] of this.attesterSlashings.entries()) {
      // Slashings that don't slash any validators can be dropped
      for (let i = 0; i < attesterSlashing.intersectingIndices.length; i++) {
        const index = attesterSlashing.intersectingIndices[i];

        // Declare that a validator is still slashable if they have not exited prior
        // to the finalized epoch.
        //
        // We cannot check the `slashed` field since the `head` is not finalized and
        // a fork could un-slash someone.
        if (headState.validators.getReadonly(index).exitEpoch > finalizedEpoch) {
          continue attesterSlashing;
        }
      }

      // All intersecting indices are not slashable
      this.attesterSlashings.delete(key);
    }
  }

  /**
   * Prune proposer slashings for validators which are exited in the finalized epoch.
   */
  private pruneProposerSlashings(headState: CachedBeaconStateAllForks): void {
    const finalizedEpoch = headState.finalizedCheckpoint.epoch;
    for (const [key, proposerSlashing] of this.proposerSlashings.entries()) {
      const index = proposerSlashing.signedHeader1.message.proposerIndex;
      if (headState.validators.getReadonly(index).exitEpoch <= finalizedEpoch) {
        this.proposerSlashings.delete(key);
      }
    }
  }

  /**
   * Call after finalizing
   * Prune if validator has already exited at or before the finalized checkpoint of the head.
   */
  private pruneVoluntaryExits(headState: CachedBeaconStateAllForks): void {
    const {config} = headState;
    const headStateFork = config.getForkSeq(headState.slot);
    const finalizedEpoch = headState.finalizedCheckpoint.epoch;

    for (const [key, voluntaryExit] of this.voluntaryExits.entries()) {
      // VoluntaryExit messages signed in the previous fork become invalid and can never be included in any future
      // block, so just drop as the head state advances into the next fork.
      if (config.getForkSeq(computeStartSlotAtEpoch(voluntaryExit.message.epoch)) < headStateFork) {
        this.voluntaryExits.delete(key);
      }

      // TODO: Improve this simplistic condition
      if (voluntaryExit.message.epoch <= finalizedEpoch) {
        this.voluntaryExits.delete(key);
      }
    }
  }

  /**
   * Prune BLS to execution changes that have been applied to the state more than 1 block ago.
   * In the worse case where head block is reorged, the same BlsToExecutionChange message can be re-added
   * to opPool once gossipsub seen cache TTL passes.
   */
  private pruneBlsToExecutionChanges(
    headBlock: allForks.SignedBeaconBlock,
    headState: CachedBeaconStateAllForks
  ): void {
    const {config} = headState;
    const recentBlsToExecutionChanges =
      config.getForkSeq(headBlock.message.slot) >= ForkSeq.capella
        ? (headBlock as capella.SignedBeaconBlock).message.body.blsToExecutionChanges
        : [];

    const recentBlsToExecutionChangeIndexes = new Set<ValidatorIndex>();
    for (const blsToExecutionChange of recentBlsToExecutionChanges) {
      recentBlsToExecutionChangeIndexes.add(blsToExecutionChange.message.validatorIndex);
    }

    for (const [key, blsToExecutionChange] of this.blsToExecutionChanges.entries()) {
      const {validatorIndex} = blsToExecutionChange.data.message;
      if (!recentBlsToExecutionChangeIndexes.has(validatorIndex)) {
        const validator = headState.validators.getReadonly(validatorIndex);
        if (validator.withdrawalCredentials[0] !== BLS_WITHDRAWAL_PREFIX) {
          this.blsToExecutionChanges.delete(key);
        }
      }
    }
  }
}

function isSlashableAtEpoch(validator: phase0.Validator, epoch: Epoch): boolean {
  return !validator.slashed && validator.activationEpoch <= epoch && epoch < validator.withdrawableEpoch;
}

/**
 * Persist target items `items` in `dbRepo` doing minimum put and delete writes.
 * Reads all keys in repository to compute the diff between current persisted data and target data.
 */
async function persistDiff<K extends Id, V>(
  dbRepo: Repository<K, V>,
  items: {key: K; value: V}[],
  serializeKey: (key: K) => number | string
): Promise<void> {
  const persistedKeys = await dbRepo.keys();
  const itemsToPut: {key: K; value: V}[] = [];
  const keysToDelete: K[] = [];

  const persistedKeysSerialized = new Set(persistedKeys.map(serializeKey));
  for (const item of items) {
    if (!persistedKeysSerialized.has(serializeKey(item.key))) {
      itemsToPut.push(item);
    }
  }

  const targetKeysSerialized = new Set(items.map((item) => serializeKey(item.key)));
  for (const persistedKey of persistedKeys) {
    if (!targetKeysSerialized.has(serializeKey(persistedKey))) {
      keysToDelete.push(persistedKey);
    }
  }

  if (itemsToPut.length > 0) await dbRepo.batchPut(itemsToPut);
  if (keysToDelete.length > 0) await dbRepo.batchDelete(keysToDelete);
}
