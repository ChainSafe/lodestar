import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {sleep, toPubkeyHex} from "@lodestar/utils";
import {
  SlotInterval,
  computeEpochAtSlot,
  endOfInterval,
  isAggregatorFromCommitteeLength,
  isStartSlotOfEpoch,
} from "@lodestar/state-transition";
import {BLSSignature, Epoch, Slot, ValidatorIndex, RootHex} from "@lodestar/types";
import {ApiClient, routes} from "@lodestar/api";
import {batchItems, IClock, LoggerVc} from "../util/index.js";
import {PubkeyHex} from "../types.js";
import {Metrics} from "../metrics.js";
import {ValidatorStore} from "./validatorStore.js";
import {ChainHeaderTracker, HeadEventData} from "./chainHeaderTracker.js";
import {SyncingStatusTracker} from "./syncingStatusTracker.js";

/** Only retain `HISTORICAL_DUTIES_EPOCHS` duties prior to the current epoch. */
const HISTORICAL_DUTIES_EPOCHS = 2;

/**
 * This is to prevent the "Request body is too large" issue for http post.
 * Typical server accept up to1MB (2 ** 20 bytes) of request body, for example fastify and nginx.
 * A typical subscription request is 107 bytes in length, make it 120 to buffer.
 * This number is Math.floor(2 ** 20 / 120)
 **/
const SUBSCRIPTIONS_PER_REQUEST = 8738;

/** Neatly joins the server-generated `AttesterData` with the locally-generated `selectionProof`. */
export type AttDutyAndProof = {
  duty: routes.validator.AttesterDuty;
  /** This value is only set to not null if the proof indicates that the validator is an aggregator. */
  selectionProof: BLSSignature | null;
  /** This value will only be set if validator is part of distributed cluster and only has a key share */
  partialSelectionProof?: BLSSignature;
};

// To assist with readability
type AttDutiesAtEpoch = {dependentRoot: RootHex; dutiesByIndex: Map<ValidatorIndex, AttDutyAndProof>};

type AttestationDutiesServiceOpts = {
  distributedAggregationSelection?: boolean;
};

export class AttestationDutiesService {
  /** Maps a validator public key to their duties for each epoch */
  private readonly dutiesByIndexByEpoch = new Map<Epoch, AttDutiesAtEpoch>();
  /**
   * We may receive new dependentRoot of an epoch but it's not the last slot of epoch
   * so we have to wait for getting close to the next epoch to redownload new attesterDuties.
   */
  private readonly pendingDependentRootByEpoch = new Map<Epoch, RootHex>();

  constructor(
    private readonly logger: LoggerVc,
    private readonly api: ApiClient,
    private clock: IClock,
    private readonly validatorStore: ValidatorStore,
    chainHeadTracker: ChainHeaderTracker,
    syncingStatusTracker: SyncingStatusTracker,
    private readonly metrics: Metrics | null,
    private readonly opts?: AttestationDutiesServiceOpts
  ) {
    // Running this task every epoch is safe since a re-org of two epochs is very unlikely
    // TODO: If the re-org event is reliable consider re-running then
    clock.runEveryEpoch(this.runDutiesTasks);
    clock.runEverySlot(this.prepareForNextEpoch);
    chainHeadTracker.runOnNewHead(this.onNewHead);
    syncingStatusTracker.runOnResynced(async (slot) => {
      // Skip on first slot of epoch since tasks are already scheduled
      if (!isStartSlotOfEpoch(slot)) {
        return this.runDutiesTasks(computeEpochAtSlot(slot));
      }
    });

    if (metrics) {
      metrics.attesterDutiesCount.addCollect(() => {
        const currentSlot = this.clock.getCurrentSlot();
        let duties = 0;
        let nextDutySlot = null;
        for (const [epoch, attDutiesAtEpoch] of this.dutiesByIndexByEpoch) {
          duties += attDutiesAtEpoch.dutiesByIndex.size;

          // Epochs are sorted, stop searching once a next duty slot is found
          if (epoch < this.clock.currentEpoch || nextDutySlot !== null) continue;

          for (const {duty} of attDutiesAtEpoch.dutiesByIndex.values()) {
            // Set next duty slot to the closest future slot found in all duties
            if (duty.slot > currentSlot && (nextDutySlot === null || duty.slot < nextDutySlot)) {
              nextDutySlot = duty.slot;
            }
          }
        }
        metrics.attesterDutiesCount.set(duties);
        metrics.attesterDutiesEpochCount.set(this.dutiesByIndexByEpoch.size);
        if (nextDutySlot !== null) metrics.attesterDutiesNextSlot.set(nextDutySlot);
      });
    }
  }

  removeDutiesForKey(pubkey: PubkeyHex): void {
    for (const [epoch, attDutiesAtEpoch] of this.dutiesByIndexByEpoch) {
      for (const [vIndex, attDutyAndProof] of attDutiesAtEpoch.dutiesByIndex) {
        if (toPubkeyHex(attDutyAndProof.duty.pubkey) === pubkey) {
          attDutiesAtEpoch.dutiesByIndex.delete(vIndex);
          if (attDutiesAtEpoch.dutiesByIndex.size === 0) {
            this.dutiesByIndexByEpoch.delete(epoch);
          }
        }
      }
    }
  }

  /** Returns all `ValidatorDuty` for the given `slot` */
  getDutiesAtSlot(slot: Slot): AttDutyAndProof[] {
    const epoch = computeEpochAtSlot(slot);
    const duties: AttDutyAndProof[] = [];
    const epochDuties = this.dutiesByIndexByEpoch.get(epoch);
    if (epochDuties === undefined) {
      return duties;
    }

    for (const validatorDuty of epochDuties.dutiesByIndex.values()) {
      if (validatorDuty.duty.slot === slot) {
        duties.push(validatorDuty);
      }
    }

    return duties;
  }

  /**
   * If a reorg dependent root comes at a slot other than last slot of epoch
   * just update this.pendingDependentRootByEpoch() and process here
   */
  private prepareForNextEpoch = async (slot: Slot, signal: AbortSignal): Promise<void> => {
    // only interested in last slot of epoch
    if ((slot + 1) % SLOTS_PER_EPOCH !== 0) {
      return;
    }

    // during the first interval of slot, last block of epoch may come
    await sleep(this.clock.msToSlotInterval(slot, endOfInterval(SlotInterval.BLOCK_PROPAGATION)), signal);

    const nextEpoch = computeEpochAtSlot(slot) + 1;
    const dependentRoot = this.dutiesByIndexByEpoch.get(nextEpoch)?.dependentRoot;
    const pendingDependentRoot = this.pendingDependentRootByEpoch.get(nextEpoch);
    if (dependentRoot && pendingDependentRoot && dependentRoot !== pendingDependentRoot) {
      // this happens when pendingDependentRoot is not the last block of an epoch
      this.logger.info("Redownload attester duties when it's close to epoch boundary", {nextEpoch, slot});
      await this.handleAttesterDutiesReorg(nextEpoch, slot, dependentRoot, pendingDependentRoot);
    }
  };

  private runDutiesTasks = async (epoch: Epoch): Promise<void> => {
    await Promise.all([
      // Run pollBeaconAttesters immediately for all known local indices
      this.pollBeaconAttesters(epoch, this.validatorStore.getAllLocalIndices()).catch((e: Error) => {
        this.logger.error("Error on poll attesters", {epoch}, e);
      }),

      // At the same time fetch any remaining unknown validator indices, then poll duties for those newIndices only
      this.validatorStore
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
      const epochDuties = this.dutiesByIndexByEpoch.get(epoch)?.dutiesByIndex;
      if (epochDuties) {
        for (const {duty, selectionProof} of epochDuties.values()) {
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
      const subscriptionsBatches = batchItems(beaconCommitteeSubscriptions, {batchSize: SUBSCRIPTIONS_PER_REQUEST});
      const responses = await Promise.all(
        subscriptionsBatches.map((subscriptions) => this.api.validator.prepareBeaconCommitteeSubnet({subscriptions}))
      );

      for (const res of responses) {
        res.assertOk();
      }
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

    const res = await this.api.validator.getAttesterDuties({epoch, indices: indexArr});
    const attesterDuties = res.value();
    const {dependentRoot} = res.meta();
    const relevantDuties = attesterDuties.filter((duty) => {
      const pubkeyHex = toPubkeyHex(duty.pubkey);
      return this.validatorStore.hasVotingPubkey(pubkeyHex) && this.validatorStore.isDoppelgangerSafe(pubkeyHex);
    });

    this.logger.debug("Downloaded attester duties", {epoch, dependentRoot, count: relevantDuties.length});

    const dutiesAtEpoch = this.dutiesByIndexByEpoch.get(epoch);
    const priorDependentRoot = dutiesAtEpoch?.dependentRoot;
    const dependentRootChanged = priorDependentRoot !== undefined && priorDependentRoot !== dependentRoot;

    if (!priorDependentRoot || dependentRootChanged) {
      const dutiesByIndex = new Map<ValidatorIndex, AttDutyAndProof>();
      for (const duty of relevantDuties) {
        const dutyAndProof = await this.getDutyAndProof(duty);
        dutiesByIndex.set(duty.validatorIndex, dutyAndProof);
      }
      this.dutiesByIndexByEpoch.set(epoch, {dependentRoot, dutiesByIndex});

      if (priorDependentRoot && dependentRootChanged) {
        this.metrics?.attesterDutiesReorg.inc();
        this.logger.warn("Attester duties re-org. This may happen from time to time", {
          priorDependentRoot: priorDependentRoot,
          dependentRoot: dependentRoot,
          epoch,
        });
      }
    } else {
      const existingDuties = dutiesAtEpoch.dutiesByIndex;
      const existingDutiesCount = existingDuties.size;
      const discoveredNewDuties = relevantDuties.length > existingDutiesCount;

      if (discoveredNewDuties) {
        for (const duty of relevantDuties) {
          if (!existingDuties.has(duty.validatorIndex)) {
            const dutyAndProof = await this.getDutyAndProof(duty);
            existingDuties.set(duty.validatorIndex, dutyAndProof);
          }
        }

        this.logger.debug("Discovered new attester duties", {
          epoch,
          dependentRoot,
          count: relevantDuties.length - existingDutiesCount,
        });
      }
    }
  }

  /**
   * attester duties may be reorged due to 2 scenarios:
   *   1. node is syncing (for nextEpoch duties)
   *   2. node is reorged
   * previousDutyDependentRoot = get_block_root_at_slot(state, compute_start_slot_at_epoch(epoch - 1) - 1)
   *   => dependent root of current epoch
   * currentDutyDependentRoot = get_block_root_at_slot(state, compute_start_slot_at_epoch(epoch) - 1)
   *   => dependent root of next epoch
   */
  private onNewHead = async ({
    slot,
    head,
    previousDutyDependentRoot,
    currentDutyDependentRoot,
  }: HeadEventData): Promise<void> => {
    const currentEpoch = computeEpochAtSlot(slot);
    const nextEpoch = currentEpoch + 1;
    const nextTwoEpoch = currentEpoch + 2;
    const nextTwoEpochDependentRoot = this.dutiesByIndexByEpoch.get(currentEpoch + 2)?.dependentRoot;

    // this may happen ONLY when node is syncing
    // it's safe to get attester duties at epoch n + 1 thanks to nextEpochShuffling cache
    // but it's an issue to request attester duties for epoch n + 2 as dependent root keeps changing while node is syncing
    // see https://github.com/ChainSafe/lodestar/issues/3211
    if (nextTwoEpochDependentRoot && head !== nextTwoEpochDependentRoot) {
      // last slot of epoch, we're sure it's the correct dependent root
      if ((slot + 1) % SLOTS_PER_EPOCH === 0) {
        this.logger.info("Next 2 epoch attester duties reorg", {slot, dutyEpoch: nextTwoEpoch, head});
        await this.handleAttesterDutiesReorg(nextTwoEpoch, slot, nextTwoEpochDependentRoot, head);
      } else {
        this.logger.debug("Potential next 2 epoch attester duties reorg", {slot, dutyEpoch: nextTwoEpoch, head});
        // node may send adjacent onHead events while it's syncing
        // wait for getting close to next epoch to make sure the dependRoot
        this.pendingDependentRootByEpoch.set(nextTwoEpoch, head);
      }
    }

    // dependent root for next epoch changed
    const nextEpochDependentRoot = this.dutiesByIndexByEpoch.get(nextEpoch)?.dependentRoot;
    if (nextEpochDependentRoot && currentDutyDependentRoot !== nextEpochDependentRoot) {
      this.logger.warn("Potential next epoch attester duties reorg", {
        slot,
        dutyEpoch: nextEpoch,
        priorDependentRoot: nextEpochDependentRoot,
        newDependentRoot: currentDutyDependentRoot,
      });
      await this.handleAttesterDutiesReorg(nextEpoch, slot, nextEpochDependentRoot, currentDutyDependentRoot);
    }

    // dependent root for current epoch changed
    const currentEpochDependentRoot = this.dutiesByIndexByEpoch.get(currentEpoch)?.dependentRoot;
    if (currentEpochDependentRoot && currentEpochDependentRoot !== previousDutyDependentRoot) {
      this.logger.warn("Potential current epoch attester duties reorg", {
        slot,
        dutyEpoch: currentEpoch,
        priorDependentRoot: currentEpochDependentRoot,
        newDependentRoot: previousDutyDependentRoot,
      });
      await this.handleAttesterDutiesReorg(currentEpoch, slot, currentEpochDependentRoot, previousDutyDependentRoot);
    }
  };

  private async handleAttesterDutiesReorg(
    dutyEpoch: Epoch,
    slot: Slot,
    oldDependentRoot: RootHex,
    newDependentRoot: RootHex
  ): Promise<void> {
    this.metrics?.attesterDutiesReorg.inc();
    const logContext = {dutyEpoch, slot, oldDependentRoot, newDependentRoot};
    this.logger.debug("Redownload attester duties", logContext);

    await this.pollBeaconAttestersForEpoch(dutyEpoch, this.validatorStore.getAllLocalIndices())
      .then(() => {
        this.pendingDependentRootByEpoch.delete(dutyEpoch);
      })
      .catch((e: Error) => {
        this.logger.error("Failed to redownload attester duties when reorg happens", logContext, e);
      });
  }

  private async getDutyAndProof(duty: routes.validator.AttesterDuty): Promise<AttDutyAndProof> {
    const selectionProof = await this.validatorStore.signAttestationSelectionProof(duty.pubkey, duty.slot);

    if (this.opts?.distributedAggregationSelection) {
      // Validator in distributed cluster only has a key share, not the full private key.
      // Passing a partial selection proof to `is_aggregator` would produce incorrect result.
      // AttestationService will exchange partial for combined selection proofs retrieved from
      // distributed validator middleware client and determine aggregators at beginning of every slot.
      return {duty, selectionProof: null, partialSelectionProof: selectionProof};
    }

    const isAggregator = isAggregatorFromCommitteeLength(duty.committeeLength, selectionProof);

    return {
      duty,
      // selectionProof === null is used to check if is aggregator
      selectionProof: isAggregator ? selectionProof : null,
    };
  }

  /** Run once per epoch to prune duties map */
  private pruneOldDuties(currentEpoch: Epoch): void {
    for (const byEpochMap of [this.dutiesByIndexByEpoch, this.pendingDependentRootByEpoch]) {
      for (const epoch of byEpochMap.keys()) {
        if (epoch + HISTORICAL_DUTIES_EPOCHS < currentEpoch) {
          byEpochMap.delete(epoch);
        }
      }
    }
  }
}
