import {computeSyncPeriodAtEpoch, computeSyncPeriodAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, BLSSignature, Epoch, Root, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {IndicesService} from "./indices";
import {IApiClient} from "../api";
import {extendError, isSyncCommitteeAggregator, notAborted} from "../util";
import {IClock} from "../util/clock";
import {ValidatorStore} from "./validatorStore";
import {SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";

/** Only retain `HISTORICAL_DUTIES_PERIODS` duties prior to the current periods. */
const HISTORICAL_DUTIES_PERIODS = 2;
/** Epochs prior to `ALTAIR_FORK_EPOCH` to start fetching duties */
const ALTAIR_FORK_LOOKAHEAD_EPOCHS = 1;
/** How many epochs prior from a subscription starting, ask the node to subscribe */
const SUBSCRIPTIONS_LOOKAHEAD_EPOCHS = 2;

export type SyncDutySubCommittee = {
  pubkey: altair.SyncDuty["pubkey"];
  validatorIndex: altair.SyncDuty["validatorIndex"];
  /** A single index of the validator in the sync committee. */
  validatorSyncCommitteeIndex: number;
};

/** Neatly joins SyncDuty with the locally-generated `selectionProof`. */
export type SyncDutyAndProof = {
  duty: SyncDutySubCommittee;
  /** This value is only set to not null if the proof indicates that the validator is an aggregator. */
  selectionProof: BLSSignature | null;
  subCommitteeIndex: number;
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
  async getDutiesAtSlot(slot: Slot): Promise<SyncDutyAndProof[]> {
    const period = computeSyncPeriodAtSlot(this.config, slot + 1); // See note above for the +1 offset
    const duties: SyncDutyAndProof[] = [];

    for (const dutiesByPeriod of this.dutiesByPeriodByIndex.values()) {
      const dutyAtPeriod = dutiesByPeriod.get(period);
      // Validator always has a duty during the entire period
      if (dutyAtPeriod) {
        for (const index of dutyAtPeriod.duty.validatorSyncCommitteeIndices) {
          duties.push(
            // Compute a different DutyAndProof for each validatorSyncCommitteeIndices. Unwrapping here simplifies downstream code.
            // getDutyAndProof() is async beacuse it may have to fetch the fork but should never happen in practice
            await this.getDutyAndProof(slot, {
              pubkey: dutyAtPeriod.duty.pubkey,
              validatorIndex: dutyAtPeriod.duty.validatorIndex,
              validatorSyncCommitteeIndex: index,
            })
          );
        }
      }
    }

    return duties;
  }

  private runDutiesTasks = async (currentEpoch: Epoch): Promise<void> => {
    // Before altair fork (+ lookahead) no need to check duties
    if (currentEpoch < this.config.params.ALTAIR_FORK_EPOCH - ALTAIR_FORK_LOOKAHEAD_EPOCHS) {
      return;
    }

    await Promise.all([
      // Run pollSyncCommittees immediately for all known local indices
      this.pollSyncCommittees(currentEpoch, this.indicesService.getAllLocalIndices()).catch((e) => {
        if (notAborted(e)) this.logger.error("Error on poll SyncDuties", {epoch: currentEpoch}, e);
      }),

      // At the same time fetch any remaining unknown validator indices, then poll duties for those newIndices only
      this.indicesService
        .pollValidatorIndices()
        .then((newIndices) => this.pollSyncCommittees(currentEpoch, newIndices))
        .catch((e) => {
          if (notAborted(e)) this.logger.error("Error on poll indices and SyncDuties", {epoch: currentEpoch}, e);
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

    const nextPeriodEpoch = currentEpoch + this.config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD;
    for (const epoch of [currentEpoch, nextPeriodEpoch]) {
      // Download the duties and update the duties for the current and next period.
      await this.pollSyncCommitteesForEpoch(epoch, indexArr).catch((e) => {
        if (notAborted(e)) this.logger.error("Failed to download SyncDuties", {epoch}, e);
      });
    }

    const currentPeriod = computeSyncPeriodAtEpoch(this.config, currentEpoch);
    const syncCommitteeSubscriptions: altair.SyncCommitteeSubscription[] = [];

    // For this and the next period, produce any beacon committee subscriptions.
    //
    // We are *always* pushing out subscriptions, even if we've subscribed before. This is
    // potentially excessive on the BN in normal cases, but it will help with fast re-subscriptions
    // if the BN goes offline or we swap to a different one.
    const indexSet = new Set(indexArr);
    for (const period of [currentPeriod, currentPeriod + 1]) {
      for (const [validatorIndex, dutiesByPeriod] of this.dutiesByPeriodByIndex.entries()) {
        const dutyAtEpoch = dutiesByPeriod.get(period);
        if (dutyAtEpoch) {
          if (indexSet.has(validatorIndex)) {
            const fromEpoch = period * this.config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD;
            const untilEpoch = (period + 1) * this.config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD;
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
      await this.apiClient.validator.prepareSyncCommitteeSubnets(syncCommitteeSubscriptions).catch((e) => {
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

    const syncDuties = await this.apiClient.validator.getSyncCommitteeDuties(epoch, indexArr).catch((e) => {
      throw extendError(e, "Failed to obtain SyncDuties");
    });
    const dependentRoot = syncDuties.dependentRoot;
    const relevantDuties = syncDuties.data.filter((duty) => this.indicesService.hasValidatorIndex(duty.validatorIndex));
    const period = computeSyncPeriodAtEpoch(this.config, epoch);

    this.logger.debug("Downloaded SyncDuties", {
      epoch,
      dependentRoot: toHexString(dependentRoot),
      count: relevantDuties.length,
    });

    for (const duty of relevantDuties) {
      let dutiesByPeriod = this.dutiesByPeriodByIndex.get(duty.validatorIndex);
      if (!dutiesByPeriod) {
        dutiesByPeriod = new Map<Epoch, DutyAtPeriod>();
        this.dutiesByPeriodByIndex.set(duty.validatorIndex, dutiesByPeriod);
      }

      // TODO: Enable dependentRoot functionality
      // Meanwhile just overwrite them, since the latest duty will be older and less likely to re-org
      //
      // Only update the duties if either is true:
      //
      // - There were no known duties for this period.
      // - The dependent root has changed, signalling a re-org.

      // Using `alreadyWarnedReorg` avoids excessive logs.
      dutiesByPeriod.set(period, {dependentRoot, duty});
    }
  }

  private async getDutyAndProof(slot: Slot, duty: SyncDutySubCommittee): Promise<SyncDutyAndProof> {
    // TODO: Cache this value
    const SYNC_COMMITTEE_SUBNET_SIZE = Math.floor(this.config.params.SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT);
    const subCommitteeIndex = Math.floor(duty.validatorSyncCommitteeIndex / SYNC_COMMITTEE_SUBNET_SIZE);
    const selectionProof = await this.validatorStore.signSyncCommitteeSelectionProof(
      // Fast indexing with precomputed pubkeyHex. Fallback to toHexString(duty.pubkey)
      this.indicesService.index2pubkey.get(duty.validatorIndex) ?? duty.pubkey,
      slot,
      subCommitteeIndex
    );
    return {
      duty,
      // selectionProof === null is used to check if is aggregator
      selectionProof: isSyncCommitteeAggregator(this.config, selectionProof) ? selectionProof : null,
      subCommitteeIndex,
    };
  }

  /** Run at least once per period to prune duties map */
  private pruneOldDuties(currentEpoch: Epoch): void {
    const currentPeriod = computeSyncPeriodAtEpoch(this.config, currentEpoch);
    for (const attMap of this.dutiesByPeriodByIndex.values()) {
      for (const period of attMap.keys()) {
        if (period + HISTORICAL_DUTIES_PERIODS < currentPeriod) {
          attMap.delete(period);
        }
      }
    }
  }
}
