import {computeSyncPeriodAtEpoch, computeSyncPeriodAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, BLSSignature, Epoch, Root, Slot, SyncPeriod, ValidatorIndex} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {IndicesService} from "./indices";
import {IApiClient} from "../api";
import {extendError, isSyncCommitteeAggregator, notAborted} from "../util";
import {IClock} from "../util/clock";
import {ValidatorStore} from "./validatorStore";

/** Only retain `HISTORICAL_DUTIES_PERIODS` duties prior to the current periods. */
const HISTORICAL_DUTIES_PERIODS = 2;
/** Epochs prior to `ALTAIR_FORK_EPOCH` to start fetching duties */
const ALTAIR_FORK_LOOKAHEAD = 1;

/** Neatly joins the server-generated `AttesterData` with the locally-generated `selectionProof`. */
export type SyncDutyAndProof = {
  duty: altair.SyncDuty;
  /** This value is only set to not null if the proof indicates that the validator is an aggregator. */
  selectionProof: BLSSignature | null;
};

// To assist with readability
type DutyAtPeriod = {dependentRoot: Root; duty: altair.SyncDuty};

/**
 * Validators are part of a static long (~27h) sync committee, and part of static subnets.
 * However, the isAggregator role changes per slot.
 */
export class SyncCommitteeDutiesService {
  /** Maps a validator public key to their duties for each slot */
  private readonly dutiesByPeriodByIndex = new Map<ValidatorIndex, Map<Slot, DutyAtPeriod>>();

  constructor(
    private readonly config: IBeaconConfig,
    private readonly logger: ILogger,
    private readonly apiClient: IApiClient,
    clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly indicesService: IndicesService
  ) {
    this.config = config;
    this.logger = logger;
    this.apiClient = apiClient;
    this.validatorStore = validatorStore;

    // Running this task every epoch is safe since a re-org of two epochs is very unlikely
    // TODO: If the re-org event is reliable consider re-running then
    clock.runEveryEpoch(this.runDutiesTasks);
  }

  /** Returns all `ValidatorDuty` for the given `slot` */
  async getDutiesAtSlot(slot: Slot): Promise<SyncDutyAndProof[]> {
    const period = computeSyncPeriodAtSlot(this.config, slot);
    const duties: SyncDutyAndProof[] = [];

    for (const dutiesByPeriod of this.dutiesByPeriodByIndex.values()) {
      const dutyAtPeriod = dutiesByPeriod.get(period);
      // Validator always has a duty during the entire period
      if (dutyAtPeriod) {
        // getDutyAndProof() is async beacuse it may have to fetch the fork but should never happen in practice
        duties.push(await this.getDutyAndProof(slot, dutyAtPeriod.duty));
      }
    }

    return duties;
  }

  private runDutiesTasks = async (epoch: Epoch): Promise<void> => {
    // Before altair fork (+ lookahead) no need to check duties
    if (epoch < this.config.params.ALTAIR_FORK_EPOCH - ALTAIR_FORK_LOOKAHEAD) {
      return;
    }

    const period = computeSyncPeriodAtEpoch(this.config, epoch);

    await Promise.all([
      // Run pollSyncCommittees immediately for all known local indices
      this.pollSyncCommittees(period, this.indicesService.getAllLocalIndices()).catch((e) => {
        if (notAborted(e)) this.logger.error("Error on poll SyncDuties", {period}, e);
      }),

      // At the same time fetch any remaining unknown validator indices, then poll duties for those newIndices only
      this.indicesService
        .pollValidatorIndices()
        .then((newIndices) => this.pollSyncCommittees(period, newIndices))
        .catch((e) => {
          if (notAborted(e)) this.logger.error("Error on poll indices and SyncDuties", {period}, e);
        }),
    ]);

    // After both, prune
    this.pruneOldDuties(period);
  };

  /**
   * Query the beacon node for SyncDuties for any known validators.
   *
   * This function will perform (in the following order):
   *
   * 1. Poll for current-period duties and update the local `this.attesters` map.
   * 2. As above, but for the next-period.
   * 3. Push out any Sync subnet subscriptions to the BN.
   * 4. Prune old entries from `this.attesters`.
   */
  private async pollSyncCommittees(currentPeriod: SyncPeriod, indexArr: ValidatorIndex[]): Promise<void> {
    // No need to bother the BN if we don't have any validators.
    if (indexArr.length === 0) {
      return;
    }

    const nextPeriod = currentPeriod + 1;
    for (const period of [currentPeriod, nextPeriod]) {
      // Download the duties and update the duties for the current and next period.
      await this.pollSyncCommitteesForEpoch(period, indexArr).catch((e) => {
        if (notAborted(e)) this.logger.error("Failed to download SyncDuties", {period}, e);
      });
    }

    const syncCommitteeSubscriptions: altair.SyncCommitteeSubscription[] = [];

    // For this and the next period, produce any beacon committee subscriptions.
    //
    // We are *always* pushing out subscriptions, even if we've subscribed before. This is
    // potentially excessive on the BN in normal cases, but it will help with fast re-subscriptions
    // if the BN goes offline or we swap to a different one.
    const indexSet = new Set(indexArr);
    for (const period of [currentPeriod, nextPeriod]) {
      for (const [validatorIndex, dutiesByPeriod] of this.dutiesByPeriodByIndex.entries()) {
        const dutyAtEpoch = dutiesByPeriod.get(period);
        if (dutyAtEpoch) {
          if (indexSet.has(validatorIndex)) {
            syncCommitteeSubscriptions.push({
              validatorIndex,
              syncCommitteeIndices: dutyAtEpoch.duty.validatorSyncCommitteeIndices,
              // TODO: Change after https://github.com/ethereum/eth2.0-APIs/issues/144
              untilEpoch: (period + 1) * this.config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
              // No need to send isAggregator here since the beacon node will assume validator always aggregates
            });
          }
        }
      }
    }

    // If there are any subscriptions, push them out to the beacon node.
    if (syncCommitteeSubscriptions.length > 0) {
      // TODO: Should log or throw?
      await this.apiClient.validator.prepareSyncCommitteeSubnets(syncCommitteeSubscriptions).catch((e) => {
        throw extendError(e, "Failed to subscribe to sync committee subnets");
      });
    }
  }

  /**
   * For the given `indexArr`, download the duties for the given `period` and store them in `this.attesters`.
   */
  private async pollSyncCommitteesForEpoch(period: SyncPeriod, indexArr: ValidatorIndex[]): Promise<void> {
    // Don't fetch duties for periods before genesis. However, should fetch period 0 duties at period -1
    if (period < 0) {
      return;
    }

    // TODO: Query by period after https://github.com/ethereum/eth2.0-APIs/issues/144
    const epoch = period * this.config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD;
    const syncDuties = await this.apiClient.validator.getSyncCommitteeDuties(epoch, indexArr).catch((e) => {
      throw extendError(e, "Failed to obtain SyncDuties");
    });
    const dependentRoot = syncDuties.dependentRoot;
    const relevantDuties = syncDuties.data.filter((duty) => this.indicesService.hasValidatorIndex(duty.validatorIndex));

    this.logger.debug("Downloaded SyncDuties", {
      period,
      dependentRoot: toHexString(dependentRoot),
      count: relevantDuties.length,
    });

    let alreadyWarnedReorg = false;
    for (const duty of relevantDuties) {
      let dutiesByPeriod = this.dutiesByPeriodByIndex.get(duty.validatorIndex);
      if (!dutiesByPeriod) {
        dutiesByPeriod = new Map<Epoch, DutyAtPeriod>();
        this.dutiesByPeriodByIndex.set(duty.validatorIndex, dutiesByPeriod);
      }
      // Only update the duties if either is true:
      //
      // - There were no known duties for this period.
      // - The dependent root has changed, signalling a re-org.
      const prior = dutiesByPeriod.get(period);
      const dependentRootChanged = prior && !this.config.types.Root.equals(prior.dependentRoot, dependentRoot);

      if (!prior || dependentRootChanged) {
        // Using `alreadyWarnedReorg` avoids excessive logs.
        dutiesByPeriod.set(period, {dependentRoot, duty});
        if (prior && dependentRootChanged && !alreadyWarnedReorg) {
          alreadyWarnedReorg = true;
          this.logger.warn("SyncDuties re-org. This may happen from time to time", {
            priorDependentRoot: toHexString(prior.dependentRoot),
            dependentRoot: toHexString(dependentRoot),
          });
        }
      }
    }
  }

  private async getDutyAndProof(slot: Slot, duty: altair.SyncDuty): Promise<SyncDutyAndProof> {
    const selectionProof = await this.validatorStore.signSelectionProof(duty.pubkey, slot);
    const isAggregator = isSyncCommitteeAggregator(this.config, selectionProof);

    return {
      duty,
      // selectionProof === null is used to check if is aggregator
      selectionProof: isAggregator ? selectionProof : null,
    };
  }

  /** Run at least once per period to prune `this.attesters` map */
  private pruneOldDuties(currentPeriod: SyncPeriod): void {
    for (const attMap of this.dutiesByPeriodByIndex.values()) {
      for (const period of attMap.keys()) {
        if (period + HISTORICAL_DUTIES_PERIODS < currentPeriod) {
          attMap.delete(period);
        }
      }
    }
  }
}
