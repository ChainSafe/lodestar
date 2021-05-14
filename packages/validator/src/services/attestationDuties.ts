import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BLSSignature, Epoch, phase0, Root, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {IndicesService} from "./indices";
import {IApiClient} from "../api";
import {extendError, isAttestationAggregator, notAborted} from "../util";
import {IClock} from "../util/clock";
import {ValidatorStore} from "./validatorStore";

/** Only retain `HISTORICAL_DUTIES_EPOCHS` duties prior to the current epoch. */
const HISTORICAL_DUTIES_EPOCHS = 2;

/** Neatly joins the server-generated `AttesterData` with the locally-generated `selectionProof`. */
export type AttDutyAndProof = {
  duty: phase0.AttesterDuty;
  /** This value is only set to not null if the proof indicates that the validator is an aggregator. */
  selectionProof: BLSSignature | null;
};

// To assist with readability
type AttDutyAtEpoch = {dependentRoot: Root; dutyAndProof: AttDutyAndProof};

export class AttestationDutiesService {
  /** Maps a validator public key to their duties for each epoch */
  private readonly dutiesByEpochByIndex = new Map<ValidatorIndex, Map<Epoch, AttDutyAtEpoch>>();

  constructor(
    private readonly config: IBeaconConfig,
    private readonly logger: ILogger,
    private readonly apiClient: IApiClient,
    clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly indicesService: IndicesService
  ) {
    // Running this task every epoch is safe since a re-org of two epochs is very unlikely
    // TODO: If the re-org event is reliable consider re-running then
    clock.runEveryEpoch(this.runDutiesTasks);
  }

  /** Returns all `ValidatorDuty` for the given `slot` */
  getDutiesAtSlot(slot: Slot): AttDutyAndProof[] {
    const epoch = computeEpochAtSlot(this.config, slot);
    const duties: AttDutyAndProof[] = [];

    for (const dutiesByEpoch of this.dutiesByEpochByIndex.values()) {
      const dutyAtEpoch = dutiesByEpoch.get(epoch);
      if (dutyAtEpoch && dutyAtEpoch.dutyAndProof.duty.slot === slot) {
        duties.push(dutyAtEpoch.dutyAndProof);
      }
    }

    return duties;
  }

  private runDutiesTasks = async (epoch: Epoch): Promise<void> => {
    await Promise.all([
      // Run pollBeaconAttesters immediately for all known local indices
      this.pollBeaconAttesters(epoch, this.indicesService.getAllLocalIndices()).catch((e) => {
        if (notAborted(e)) this.logger.error("Error on poll attesters", {epoch}, e);
      }),

      // At the same time fetch any remaining unknown validator indices, then poll duties for those newIndices only
      this.indicesService
        .pollValidatorIndices()
        .then((newIndices) => this.pollBeaconAttesters(epoch, newIndices))
        .catch((e) => {
          if (notAborted(e)) this.logger.error("Error on poll indices and attesters", {epoch}, e);
        }),
    ]);

    // After both, prune
    this.pruneOldDuties(epoch);
  };

  /**
   * Query the beacon node for attestation duties for any known validators.
   *
   * This function will perform (in the following order):
   *
   * 1. Poll for current-epoch duties and update the local `this.attesters` map.
   * 2. As above, but for the next-epoch.
   * 3. Push out any attestation subnet subscriptions to the BN.
   * 4. Prune old entries from `this.attesters`.
   */
  private async pollBeaconAttesters(currentEpoch: Epoch, indexArr: ValidatorIndex[]): Promise<void> {
    const nextEpoch = currentEpoch + 1;

    // No need to bother the BN if we don't have any validators.
    if (indexArr.length === 0) {
      return;
    }

    for (const epoch of [currentEpoch, nextEpoch]) {
      // Download the duties and update the duties for the current and next epoch.
      await this.pollBeaconAttestersForEpoch(epoch, indexArr).catch((e) => {
        if (notAborted(e)) this.logger.error("Failed to download attester duties", {epoch}, e);
      });
    }

    const beaconCommitteeSubscriptions: phase0.BeaconCommitteeSubscription[] = [];

    // For this epoch and the next epoch, produce any beacon committee subscriptions.
    //
    // We are *always* pushing out subscriptions, even if we've subscribed before. This is
    // potentially excessive on the BN in normal cases, but it will help with fast re-subscriptions
    // if the BN goes offline or we swap to a different one.
    const indexSet = new Set(indexArr);
    for (const epoch of [currentEpoch, nextEpoch]) {
      for (const dutiesByEpoch of this.dutiesByEpochByIndex.values()) {
        const dutyAtEpoch = dutiesByEpoch.get(epoch);
        if (dutyAtEpoch) {
          const {duty, selectionProof} = dutyAtEpoch.dutyAndProof;
          if (indexSet.has(duty.validatorIndex)) {
            beaconCommitteeSubscriptions.push({
              validatorIndex: duty.validatorIndex,
              committeesAtSlot: duty.committeesAtSlot,
              committeeIndex: duty.committeeIndex,
              slot: duty.slot,
              isAggregator: selectionProof !== null,
            });
          }
        }
      }
    }

    // If there are any subscriptions, push them out to the beacon node.
    if (beaconCommitteeSubscriptions.length > 0) {
      // TODO: Should log or throw?
      await this.apiClient.validator.prepareBeaconCommitteeSubnet(beaconCommitteeSubscriptions).catch((e) => {
        throw extendError(e, "Failed to subscribe to beacon committee subnets");
      });
    }
  }

  /** For the given `indexArr`, download the duties for the given `epoch` and
      store them in `this.attesters`. */
  private async pollBeaconAttestersForEpoch(epoch: Epoch, indexArr: ValidatorIndex[]): Promise<void> {
    // Don't fetch duties for epochs before genesis. However, should fetch epoch 0 duties at epoch -1
    if (epoch < 0) {
      return;
    }

    // TODO: Implement dependentRoot logic
    const attesterDuties = await this.apiClient.validator.getAttesterDuties(epoch, indexArr).catch((e) => {
      throw extendError(e, "Failed to obtain attester duty");
    });
    const dependentRoot = attesterDuties.dependentRoot;
    const relevantDuties = attesterDuties.data.filter((duty) =>
      this.validatorStore.hasVotingPubkey(toHexString(duty.pubkey))
    );

    this.logger.debug("Downloaded attester duties", {
      epoch,
      dependentRoot: toHexString(dependentRoot),
      count: relevantDuties.length,
    });

    let alreadyWarnedReorg = false;
    for (const duty of relevantDuties) {
      let dutiesByEpoch = this.dutiesByEpochByIndex.get(duty.validatorIndex);
      if (!dutiesByEpoch) {
        dutiesByEpoch = new Map<Epoch, AttDutyAtEpoch>();
        this.dutiesByEpochByIndex.set(duty.validatorIndex, dutiesByEpoch);
      }

      // Only update the duties if either is true:
      //
      // - There were no known duties for this epoch.
      // - The dependent root has changed, signalling a re-org.
      const prior = dutiesByEpoch.get(epoch);
      const dependentRootChanged = prior && !this.config.types.Root.equals(prior.dependentRoot, dependentRoot);

      if (!prior || dependentRootChanged) {
        const dutyAndProof = await this.getDutyAndProof(duty);

        // Using `alreadyWarnedReorg` avoids excessive logs.
        dutiesByEpoch.set(epoch, {dependentRoot, dutyAndProof});
        if (prior && dependentRootChanged && !alreadyWarnedReorg) {
          alreadyWarnedReorg = true;
          this.logger.warn("Attester duties re-org. This may happen from time to time", {
            priorDependentRoot: toHexString(prior.dependentRoot),
            dependentRoot: toHexString(dependentRoot),
          });
        }
      }
    }
  }

  private async getDutyAndProof(duty: phase0.AttesterDuty): Promise<AttDutyAndProof> {
    const selectionProof = await this.validatorStore.signSelectionProof(duty.pubkey, duty.slot);
    const isAggregator = isAttestationAggregator(this.config, duty, selectionProof);

    return {
      duty,
      // selectionProof === null is used to check if is aggregator
      selectionProof: isAggregator ? selectionProof : null,
    };
  }

  /** Run once per epoch to prune `this.attesters` map */
  private pruneOldDuties(currentEpoch: Epoch): void {
    for (const attMap of this.dutiesByEpochByIndex.values()) {
      for (const epoch of attMap.keys()) {
        if (epoch + HISTORICAL_DUTIES_EPOCHS < currentEpoch) {
          attMap.delete(epoch);
        }
      }
    }
  }
}
