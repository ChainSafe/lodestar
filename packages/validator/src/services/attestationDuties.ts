import {computeEpochAtSlot, isAggregatorFromCommitteeLength} from "@chainsafe/lodestar-beacon-state-transition";
import {BLSSignature, Epoch, Root, Slot, ssz, ValidatorIndex} from "@chainsafe/lodestar-types";
import {Api, routes} from "@chainsafe/lodestar-api";
import {toHexString} from "@chainsafe/ssz";
import {IndicesService} from "./indices";
import {IClock, extendError, ILoggerVc} from "../util";
import {ValidatorStore} from "./validatorStore";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {sleep} from "@chainsafe/lodestar-utils";
import {ChainHeaderTracker, SlotRoot} from "./chainHeaderTracker";

/** Only retain `HISTORICAL_DUTIES_EPOCHS` duties prior to the current epoch. */
const HISTORICAL_DUTIES_EPOCHS = 2;

/** Neatly joins the server-generated `AttesterData` with the locally-generated `selectionProof`. */
export type AttDutyAndProof = {
  duty: routes.validator.AttesterDuty;
  /** This value is only set to not null if the proof indicates that the validator is an aggregator. */
  selectionProof: BLSSignature | null;
};

export class AttestationDutiesService {
  /** Maps a validator public key to their duties for each epoch */
  private readonly dutiesByEpochByIndex = new Map<ValidatorIndex, Map<Epoch, AttDutyAndProof>>();
  private readonly dependentRootByEpoch = new Map<Epoch, Root>();
  /**
   * We may receive new dependentRoot of an epoch but it's not the last slot of epoch
   * so we have to wait for getting close to the next epoch to redownload new attesterDuties.
   */
  private readonly pendingDependentRootByEpoch = new Map<Epoch, Root>();

  constructor(
    private readonly logger: ILoggerVc,
    private readonly api: Api,
    private clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly indicesService: IndicesService,
    chainHeadTracker: ChainHeaderTracker
  ) {
    // Running this task every epoch is safe since a re-org of two epochs is very unlikely
    // TODO: If the re-org event is reliable consider re-running then
    clock.runEveryEpoch(this.runDutiesTasks);
    clock.runEverySlot(this.prepareForNextEpoch);
    chainHeadTracker.runOnNewHead(this.onNewHead);
  }

  /** Returns all `ValidatorDuty` for the given `slot` */
  getDutiesAtSlot(slot: Slot): AttDutyAndProof[] {
    const epoch = computeEpochAtSlot(slot);
    const duties: AttDutyAndProof[] = [];

    for (const dutiesByEpoch of this.dutiesByEpochByIndex.values()) {
      const dutyAtEpoch = dutiesByEpoch.get(epoch);
      if (dutyAtEpoch && dutyAtEpoch.duty.slot === slot) {
        duties.push(dutyAtEpoch);
      }
    }

    return duties;
  }

  /**
   * If a reorg dependent root comes at a slot other than last slot of epoch
   * just update this.pendingDependentRootByEpoch() and process here
   * @returns
   */
  private prepareForNextEpoch = async (slot: Slot): Promise<void> => {
    // only interested in last slot of epoch
    if ((slot + 1) % SLOTS_PER_EPOCH !== 0) {
      return;
    }
    // during the 1 / 3 of epoch, last block of epoch may come
    await sleep(this.clock.msToSlotFraction(slot, 1 / 3));
    const nextEpoch = computeEpochAtSlot(slot) + 1;
    const dependentRoot = this.dependentRootByEpoch.get(nextEpoch);
    const pendingDependentRoot = this.pendingDependentRootByEpoch.get(nextEpoch);
    if (dependentRoot && pendingDependentRoot && !ssz.Root.equals(dependentRoot, pendingDependentRoot)) {
      // this happens when pendingDependentRoot is not the last block of an epoch
      this.logger.info("Redownload attester duties when it's close to epoch boundary", {nextEpoch, slot});
      await this.handleDutiesReorg(nextEpoch, slot, dependentRoot, pendingDependentRoot);
    }
  };

  private runDutiesTasks = async (epoch: Epoch): Promise<void> => {
    await Promise.all([
      // Run pollBeaconAttesters immediately for all known local indices
      this.pollBeaconAttesters(epoch, this.indicesService.getAllLocalIndices()).catch((e: Error) => {
        this.logger.error("Error on poll attesters", {epoch}, e);
      }),

      // At the same time fetch any remaining unknown validator indices, then poll duties for those newIndices only
      this.indicesService
        .pollValidatorIndices()
        .then((newIndices) => this.pollBeaconAttesters(epoch, newIndices))
        .catch((e: Error) => {
          this.logger.error("Error on poll indices and attesters", {epoch}, e);
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
   * 1. Poll for current-epoch duties and update the local duties map.
   * 2. As above, but for the next-epoch.
   * 3. Push out any attestation subnet subscriptions to the BN.
   * 4. Prune old entries from duties.
   */
  private async pollBeaconAttesters(currentEpoch: Epoch, indexArr: ValidatorIndex[]): Promise<void> {
    const nextEpoch = currentEpoch + 1;

    // No need to bother the BN if we don't have any validators.
    if (indexArr.length === 0) {
      return;
    }

    for (const epoch of [currentEpoch, nextEpoch]) {
      // Download the duties and update the duties for the current and next epoch.
      await this.pollBeaconAttestersForEpoch(epoch, indexArr).catch((e: Error) => {
        this.logger.error("Failed to download attester duties", {epoch}, e);
      });
    }

    const beaconCommitteeSubscriptions: routes.validator.BeaconCommitteeSubscription[] = [];

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
          const {duty, selectionProof} = dutyAtEpoch;
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
      await this.api.validator.prepareBeaconCommitteeSubnet(beaconCommitteeSubscriptions).catch((e: Error) => {
        throw extendError(e, "Failed to subscribe to beacon committee subnets");
      });
    }
  }

  /**
   * For the given `indexArr`, download the duties for the given `epoch` and store them in duties.
   */
  private async pollBeaconAttestersForEpoch(epoch: Epoch, indexArr: ValidatorIndex[]): Promise<void> {
    // Don't fetch duties for epochs before genesis. However, should fetch epoch 0 duties at epoch -1
    if (epoch < 0) {
      return;
    }

    const attesterDuties = await this.api.validator.getAttesterDuties(epoch, indexArr).catch((e: Error) => {
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
        dutiesByEpoch = new Map<Epoch, AttDutyAndProof>();
        this.dutiesByEpochByIndex.set(duty.validatorIndex, dutiesByEpoch);
      }

      // Only update the duties if either is true:
      //
      // - There were no known duties for this epoch.
      // - The dependent root has changed, signalling a re-org.
      const prior = dutiesByEpoch.get(epoch);
      const priorDependentRoot = this.dependentRootByEpoch.get(epoch);
      const dependentRootChanged = priorDependentRoot && !ssz.Root.equals(priorDependentRoot, dependentRoot);

      if (!prior || dependentRootChanged) {
        const dutyAndProof = await this.getDutyAndProof(duty);

        // Using `alreadyWarnedReorg` avoids excessive logs.
        dutiesByEpoch.set(epoch, dutyAndProof);
        this.dependentRootByEpoch.set(epoch, dependentRoot);
        if (prior && dependentRootChanged && !alreadyWarnedReorg) {
          alreadyWarnedReorg = true;
          this.logger.warn("Attester duties re-org. This may happen from time to time", {
            priorDependentRoot: toHexString(priorDependentRoot),
            dependentRoot: toHexString(dependentRoot),
          });
        }
      }
    }
  }

  private onNewHead = async ({slot, root}: SlotRoot): Promise<void> => {
    for (const [dutyEpoch, dependentRoot] of this.dependentRootByEpoch.entries()) {
      if (computeEpochAtSlot(slot) === dutyEpoch - 2 && !ssz.Root.equals(root, dependentRoot)) {
        // last slot of epoch, we're sure it's the correct dependent root
        if ((slot + 1) % SLOTS_PER_EPOCH === 0) {
          this.logger.info("Found attesterDuties reorg through new head", {slot, dutyEpoch, root: toHexString(root)});
          await this.handleDutiesReorg(dutyEpoch, slot, dependentRoot, root);
        } else {
          this.logger.debug("Potential attesterDuties reorg with new head", {slot, dutyEpoch, root: toHexString(root)});
          // node may send adjacent onHead events while it's syncing
          // wait for getting close to next epoch to make sure the dependRoot
          this.pendingDependentRootByEpoch.set(dutyEpoch, root);
        }
      }
    }
  };

  private async handleDutiesReorg(
    epoch: Epoch,
    slot: Slot,
    oldDependentRoot: Root,
    newDependentRoot: Root
  ): Promise<void> {
    const logContext = {
      epoch,
      slot,
      oldDependentRoot: toHexString(oldDependentRoot),
      newDependentRoot: toHexString(newDependentRoot),
    };
    this.logger.debug("handleDutiesReorg: redownload attester duties", logContext);
    await this.pollBeaconAttestersForEpoch(epoch, this.indicesService.getAllLocalIndices())
      .then(() => {
        this.pendingDependentRootByEpoch.delete(epoch);
      })
      .catch((e: Error) => {
        this.logger.error("Failed to redownload attester duties when reorg happens", logContext, e);
      });
  }

  private async getDutyAndProof(duty: routes.validator.AttesterDuty): Promise<AttDutyAndProof> {
    const selectionProof = await this.validatorStore.signAttestationSelectionProof(duty.pubkey, duty.slot);
    const isAggregator = isAggregatorFromCommitteeLength(duty.committeeLength, selectionProof);

    return {
      duty,
      // selectionProof === null is used to check if is aggregator
      selectionProof: isAggregator ? selectionProof : null,
    };
  }

  /** Run once per epoch to prune duties map */
  private pruneOldDuties(currentEpoch: Epoch): void {
    for (const attMap of this.dutiesByEpochByIndex.values()) {
      for (const epoch of attMap.keys()) {
        if (epoch + HISTORICAL_DUTIES_EPOCHS < currentEpoch) {
          attMap.delete(epoch);
        }
      }
    }
    for (const dependentRootByEpoch of [this.dependentRootByEpoch, this.pendingDependentRootByEpoch]) {
      for (const epoch of dependentRootByEpoch.keys()) {
        if (epoch + HISTORICAL_DUTIES_EPOCHS < currentEpoch) {
          dependentRootByEpoch.delete(epoch);
        }
      }
    }
  }
}
