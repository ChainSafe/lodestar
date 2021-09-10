import {CachedBeaconState, computeEpochAtSlot, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {MAX_PROPOSER_SLASHINGS, MAX_VOLUNTARY_EXITS} from "@chainsafe/lodestar-params";
import {Epoch, phase0, ssz, ValidatorIndex} from "@chainsafe/lodestar-types";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {IBeaconDb} from "../../db";

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

  static async fromPersisted(db: IBeaconDb): Promise<OpPool> {
    const opPool = new OpPool();

    const [attesterSlashings, proposerSlashings, voluntaryExits] = await Promise.all([
      db.attesterSlashing.entries(),
      db.proposerSlashing.values(),
      db.voluntaryExit.values(),
    ]);

    for (const attesterSlashing of attesterSlashings) {
      opPool.insertAttesterSlashing(attesterSlashing.value, attesterSlashing.key);
    }
    for (const proposerSlashing of proposerSlashings) {
      opPool.insertProposerSlashing(proposerSlashing);
    }
    for (const voluntaryExit of voluntaryExits) {
      opPool.insertVoluntaryExit(voluntaryExit);
    }

    return opPool;
  }

  async toPersisted(db: IBeaconDb): Promise<void> {
    // TODO: Only write new content
    await Promise.all([
      db.attesterSlashing.batchPut(
        Array.from(this.attesterSlashings.entries()).map(([key, value]) => ({
          key: fromHexString(key),
          value: value.attesterSlashing,
        }))
      ),
      db.proposerSlashing.batchPut(Array.from(this.proposerSlashings.entries()).map(([key, value]) => ({key, value}))),
      db.voluntaryExit.batchPut(Array.from(this.voluntaryExits.entries()).map(([key, value]) => ({key, value}))),
    ]);
  }

  /// Insert an attester slashing into the pool.
  insertAttesterSlashing(attesterSlashing: phase0.AttesterSlashing, rootHash?: Uint8Array): void {
    if (!rootHash) rootHash = ssz.phase0.AttesterSlashing.hashTreeRoot(attesterSlashing);
    const intersectingIndices = getAttesterSlashableIndices(attesterSlashing);
    this.attesterSlashings.set(toHexString(rootHash), {
      attesterSlashing,
      intersectingIndices,
    });
  }

  insertProposerSlashing(proposerSlashing: phase0.ProposerSlashing): void {
    this.proposerSlashings.set(proposerSlashing.signedHeader1.message.proposerIndex, proposerSlashing);
  }

  /** Must be validated beforehand */
  insertVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): void {
    this.voluntaryExits.set(voluntaryExit.message.validatorIndex, voluntaryExit);
  }

  /**
   * Get proposer and attester slashings for inclusion in a block.
   *
   * This function computes both types of slashings together, because attester slashings may be invalidated by
   * proposer slashings included earlier in the block.
   */
  getSlashings(state: phase0.BeaconState): [phase0.AttesterSlashing[], phase0.ProposerSlashing[]] {
    const stateEpoch = computeEpochAtSlot(state.slot);
    const toBeSlashedIndices: ValidatorIndex[] = [];
    const proposerSlashings: phase0.ProposerSlashing[] = [];

    for (const proposerSlashing of this.proposerSlashings.values()) {
      const index = proposerSlashing.signedHeader1.message.proposerIndex;
      const validator = state.validators[index];
      if (!validator.slashed && validator.activationEpoch <= stateEpoch && stateEpoch < validator.withdrawableEpoch) {
        proposerSlashings.push(proposerSlashing);
        // Set of validators to be slashed, so we don't attempt to construct invalid attester slashings.
        toBeSlashedIndices.push(index);
        if (proposerSlashings.length >= MAX_PROPOSER_SLASHINGS) {
          break;
        }
      }
    }

    const attesterSlashings: phase0.AttesterSlashing[] = [];
    attesterSlashing: for (const attesterSlashing of this.attesterSlashings.values()) {
      for (let i = 0; i < attesterSlashing.intersectingIndices.length; i++) {
        const index = attesterSlashing.intersectingIndices[i];
        const validator = state.validators[index];
        if (isSlashableAtEpoch(validator, stateEpoch)) {
          // At least one validator is slashable, include. TODO: Optimize including the biggest attester slashings
          attesterSlashings.push(attesterSlashing.attesterSlashing);
          continue attesterSlashing;
        }
      }
    }

    return [attesterSlashings, proposerSlashings];
  }

  /** Get a list of voluntary exits for inclusion in a block */
  getVoluntaryExits(state: CachedBeaconState<allForks.BeaconState>): phase0.SignedVoluntaryExit[] {
    const voluntaryExits: phase0.SignedVoluntaryExit[] = [];
    for (const voluntaryExit of this.voluntaryExits.values()) {
      if (allForks.isValidVoluntaryExit(state, voluntaryExit, false)) {
        voluntaryExits.push(voluntaryExit);
        if (voluntaryExits.length >= MAX_VOLUNTARY_EXITS) {
          break;
        }
      }
    }
    return voluntaryExits;
  }

  /**
   * Prune attester slashings for all slashed or withdrawn validators.
   */
  pruneAttesterSlashings(headState: phase0.BeaconState): void {
    const finalizedEpoch = headState.finalizedCheckpoint.epoch;
    attesterSlashing: for (const attesterSlashing of this.attesterSlashings.values()) {
      // Slashings that don't slash any validators can be dropped
      for (let i = 0; i < attesterSlashing.intersectingIndices.length; i++) {
        const index = attesterSlashing.intersectingIndices[i];

        // Declare that a validator is still slashable if they have not exited prior
        // to the finalized epoch.
        //
        // We cannot check the `slashed` field since the `head` is not finalized and
        // a fork could un-slash someone.
        if (headState.validators[index].exitEpoch > finalizedEpoch) {
          continue attesterSlashing;
        }
      }

      // All intersecting indices are not slashable
      // PRUNE
    }
  }

  /**
   * Prune proposer slashings for validators which are exited in the finalized epoch.
   */
  pruneProposerSlashings(headState: phase0.BeaconState): void {
    const finalizedEpoch = headState.finalizedCheckpoint.epoch;
    for (const proposerSlashing of this.proposerSlashings.values()) {
      const index = proposerSlashing.signedHeader1.message.proposerIndex;
      if (headState.validators[index].exitEpoch <= finalizedEpoch) {
        // PRUNE
      }
    }
  }

  /**
   * Call after finalizing
   * Prune if validator has already exited at or before the finalized checkpoint of the head.
   */
  pruneVoluntaryExits(headState: phase0.BeaconState): void {
    const finalizedEpoch = headState.finalizedCheckpoint.epoch;
    for (const voluntaryExit of this.voluntaryExits.values()) {
      // TODO: Improve this simplistic condition
      if (voluntaryExit.message.epoch <= finalizedEpoch) {
        // PRUNE
      }
    }
  }
}

function isSlashableAtEpoch(validator: phase0.Validator, epoch: Epoch): boolean {
  return !validator.slashed && validator.activationEpoch <= epoch && epoch < validator.withdrawableEpoch;
}

function getAttesterSlashableIndices(attesterSlashing: phase0.AttesterSlashing): ValidatorIndex[] {
  const indices: ValidatorIndex[] = [];
  const attSet1 = new Set(attesterSlashing.attestation1.attestingIndices);
  const attArr2 = attesterSlashing.attestation2.attestingIndices;
  for (let i = 0, len = attArr2.length; i < len; i++) {
    const index = attArr2[i];
    if (attSet1.has(index)) {
      indices.push(index);
    }
  }
  return indices;
}
