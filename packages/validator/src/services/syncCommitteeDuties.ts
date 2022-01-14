import {
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  SYNC_COMMITTEE_SIZE,
  SYNC_COMMITTEE_SUBNET_COUNT,
} from "@chainsafe/lodestar-params";
import {
  computeSyncPeriodAtEpoch,
  computeSyncPeriodAtSlot,
  isSyncCommitteeAggregator,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {BLSSignature, Epoch, Root, Slot, SyncPeriod, ValidatorIndex} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {Api, routes} from "@chainsafe/lodestar-api";
import {IndicesService} from "./indices";
import {IClock, extendError, ILoggerVc} from "../util";
import {ValidatorStore} from "./validatorStore";

/** Only retain `HISTORICAL_DUTIES_PERIODS` duties prior to the current periods. */
const HISTORICAL_DUTIES_PERIODS = 2;
/** Epochs prior to `ALTAIR_FORK_EPOCH` to start fetching duties */
const ALTAIR_FORK_LOOKAHEAD_EPOCHS = 1;
/** How many epochs prior from a subscription starting, ask the node to subscribe */
const SUBSCRIPTIONS_LOOKAHEAD_EPOCHS = 2;

export type SyncSelectionProof = {
  /** This value is only set to not null if the proof indicates that the validator is an aggregator. */
  selectionProof: BLSSignature | null;
  subCommitteeIndex: number;
};

/** Neatly joins SyncDuty with the locally-generated `selectionProof`. */
export type SyncDutyAndProofs = {
  duty: routes.validator.SyncDuty;
  selectionProofs: SyncSelectionProof[];
};

// To assist with readability
type DutyAtPeriod = {dependentRoot: Root; duty: routes.validator.SyncDuty};

/**
 * Validators are part of a static long (~27h) sync committee, and part of static subnets.
 * However, the isAggregator role changes per slot.
 */
export class SyncCommitteeDutiesService {
  /** Maps a validator public key to their duties for each slot */
  private readonly dutiesByIndexByPeriod = new Map<SyncPeriod, Map<ValidatorIndex, DutyAtPeriod>>();

  constructor(
    private readonly config: IChainForkConfig,
    private readonly logger: ILoggerVc,
    private readonly api: Api,
    clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly indicesService: IndicesService
  ) {
    // Running this task every epoch is safe since a re-org of many epochs is very unlikely
    // TODO: If the re-org event is reliable consider re-running then
    clock.runEveryEpoch(this.runDutiesTasks);
  }

  /**
   * Returns all `ValidatorDuty` for the given `slot`
   *
   * Note: The range of slots a validator has to perform duties is off by one.
   * The previous slot wording means that if your validator is in a sync committee for a period that runs from slot
   * 100 to 200,then you would actually produce signatures in slot 99 - 199.
   * https://github.com/ethereum/eth2.0-specs/pull/2400
   */
  async getDutiesAtSlot(slot: Slot): Promise<SyncDutyAndProofs[]> {
    const period = computeSyncPeriodAtSlot(slot + 1); // See note above for the +1 offset
    const duties: SyncDutyAndProofs[] = [];

    const dutiesByIndex = this.dutiesByIndexByPeriod.get(period);
    if (dutiesByIndex) {
      for (const dutyAtPeriod of dutiesByIndex.values()) {
        // Validator always has a duty during the entire period
        duties.push({
          duty: dutyAtPeriod.duty,
          selectionProofs: await this.getSelectionProofs(slot, dutyAtPeriod.duty),
        });
      }
    }

    return duties;
  }

  private runDutiesTasks = async (currentEpoch: Epoch): Promise<void> => {
    // Before altair fork (+ lookahead) no need to check duties
    if (currentEpoch < this.config.ALTAIR_FORK_EPOCH - ALTAIR_FORK_LOOKAHEAD_EPOCHS) {
      return;
    }

    await Promise.all([
      // Run pollSyncCommittees immediately for all known local indices
      this.pollSyncCommittees(currentEpoch, this.indicesService.getAllLocalIndices()).catch((e: Error) => {
        this.logger.error("Error on poll SyncDuties", {epoch: currentEpoch}, e);
      }),

      // At the same time fetch any remaining unknown validator indices, then poll duties for those newIndices only
      this.indicesService
        .pollValidatorIndices()
        .then((newIndices) => this.pollSyncCommittees(currentEpoch, newIndices))
        .catch((e: Error) => {
          this.logger.error("Error on poll indices and SyncDuties", {epoch: currentEpoch}, e);
        }),
    ]);

    // After both, prune
    this.pruneOldDuties(currentEpoch);
  };

  /**
   * Query the beacon node for SyncDuties for any known validators.
   *
   * This function will perform (in the following order):
   *
   * 1. Poll for current-period duties and update the local duties map.
   * 2. As above, but for the next-period.
   * 3. Push out any Sync subnet subscriptions to the BN.
   * 4. Prune old entries from duties.
   */
  private async pollSyncCommittees(currentEpoch: Epoch, indexArr: ValidatorIndex[]): Promise<void> {
    // No need to bother the BN if we don't have any validators.
    if (indexArr.length === 0) {
      return;
    }

    const nextPeriodEpoch = currentEpoch + EPOCHS_PER_SYNC_COMMITTEE_PERIOD;
    for (const epoch of [currentEpoch, nextPeriodEpoch]) {
      // Download the duties and update the duties for the current and next period.
      await this.pollSyncCommitteesForEpoch(epoch, indexArr).catch((e: Error) => {
        this.logger.error("Failed to download SyncDuties", {epoch}, e);
      });
    }

    const currentPeriod = computeSyncPeriodAtEpoch(currentEpoch);
    const syncCommitteeSubscriptions: routes.validator.SyncCommitteeSubscription[] = [];

    // For this and the next period, produce any beacon committee subscriptions.
    //
    // We are *always* pushing out subscriptions, even if we've subscribed before. This is
    // potentially excessive on the BN in normal cases, but it will help with fast re-subscriptions
    // if the BN goes offline or we swap to a different one.
    const indexSet = new Set(indexArr);
    for (const period of [currentPeriod, currentPeriod + 1]) {
      const dutiesByIndex = this.dutiesByIndexByPeriod.get(period);
      if (dutiesByIndex) {
        for (const [validatorIndex, dutyAtEpoch] of dutiesByIndex.entries()) {
          if (indexSet.has(validatorIndex)) {
            const fromEpoch = period * EPOCHS_PER_SYNC_COMMITTEE_PERIOD;
            const untilEpoch = (period + 1) * EPOCHS_PER_SYNC_COMMITTEE_PERIOD;
            // Don't subscribe too early to save node's resources
            if (currentEpoch >= fromEpoch - SUBSCRIPTIONS_LOOKAHEAD_EPOCHS) {
              syncCommitteeSubscriptions.push({
                validatorIndex,
                syncCommitteeIndices: dutyAtEpoch.duty.validatorSyncCommitteeIndices,
                untilEpoch,
                // No need to send isAggregator here since the beacon node will assume validator always aggregates
              });
            }
          }
        }
      }
    }

    // If there are any subscriptions, push them out to the beacon node.
    if (syncCommitteeSubscriptions.length > 0) {
      // TODO: Should log or throw?
      await this.api.validator.prepareSyncCommitteeSubnets(syncCommitteeSubscriptions).catch((e: Error) => {
        throw extendError(e, "Failed to subscribe to sync committee subnets");
      });
    }
  }

  /**
   * For the given `indexArr`, download the duties for the given `period` and store them in duties.
   */
  private async pollSyncCommitteesForEpoch(epoch: Epoch, indexArr: ValidatorIndex[]): Promise<void> {
    // Don't fetch duties for periods before genesis. However, should fetch period 0 duties at period -1
    if (epoch < 0) {
      return;
    }

    const syncDuties = await this.api.validator.getSyncCommitteeDuties(epoch, indexArr).catch((e: Error) => {
      throw extendError(e, "Failed to obtain SyncDuties");
    });
    const dependentRoot = syncDuties.dependentRoot;
    const period = computeSyncPeriodAtEpoch(epoch);

    let count = 0;

    for (const duty of syncDuties.data) {
      if (!this.indicesService.hasValidatorIndex(duty.validatorIndex)) {
        continue;
      }
      count++;

      let dutiesByIndex = this.dutiesByIndexByPeriod.get(period);
      if (!dutiesByIndex) {
        dutiesByIndex = new Map<ValidatorIndex, DutyAtPeriod>();
        this.dutiesByIndexByPeriod.set(period, dutiesByIndex);
      }

      // TODO: Enable dependentRoot functionality
      // Meanwhile just overwrite them, since the latest duty will be older and less likely to re-org
      //
      // Only update the duties if either is true:
      //
      // - There were no known duties for this period.
      // - The dependent root has changed, signalling a re-org.

      // Using `alreadyWarnedReorg` avoids excessive logs.
      dutiesByIndex.set(duty.validatorIndex, {dependentRoot, duty});
    }

    this.logger.debug("Downloaded SyncDuties", {epoch, dependentRoot: toHexString(dependentRoot), count});
  }

  private async getSelectionProofs(slot: Slot, duty: routes.validator.SyncDuty): Promise<SyncSelectionProof[]> {
    // TODO: Cache this value
    const SYNC_COMMITTEE_SUBNET_SIZE = Math.floor(SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT);
    // Fast indexing with precomputed pubkeyHex. Fallback to toHexString(duty.pubkey)
    const pubkey = this.indicesService.index2pubkey.get(duty.validatorIndex) ?? duty.pubkey;

    const dutiesAndProofs: SyncSelectionProof[] = [];
    for (const index of duty.validatorSyncCommitteeIndices) {
      const subCommitteeIndex = Math.floor(index / SYNC_COMMITTEE_SUBNET_SIZE);
      const selectionProof = await this.validatorStore.signSyncCommitteeSelectionProof(pubkey, slot, subCommitteeIndex);
      dutiesAndProofs.push({
        // selectionProof === null is used to check if is aggregator
        selectionProof: isSyncCommitteeAggregator(selectionProof) ? selectionProof : null,
        subCommitteeIndex,
      });
    }
    return dutiesAndProofs;
  }

  /** Run at least once per period to prune duties map */
  private pruneOldDuties(currentEpoch: Epoch): void {
    const currentPeriod = computeSyncPeriodAtEpoch(currentEpoch);
    for (const period of this.dutiesByIndexByPeriod.keys()) {
      if (period + HISTORICAL_DUTIES_PERIODS < currentPeriod) {
        this.dutiesByIndexByPeriod.delete(period);
      }
    }
  }
}
