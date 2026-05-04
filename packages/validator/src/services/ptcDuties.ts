import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH, isForkPostGloas} from "@lodestar/params";
import {computeEpochAtSlot, isStartSlotOfEpoch} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {toPubkeyHex} from "@lodestar/utils";
import {Metrics} from "../metrics.js";
import {PubkeyHex} from "../types.js";
import {IClock, LoggerVc} from "../util/index.js";
import {ChainHeaderTracker, HeadEventData} from "./chainHeaderTracker.js";
import {SyncingStatusTracker} from "./syncingStatusTracker.js";
import {ValidatorStore} from "./validatorStore.js";

/** Only retain `HISTORICAL_DUTIES_EPOCHS` duties prior to the current epoch. */
const HISTORICAL_DUTIES_EPOCHS = 2;

type PtcDutiesAtEpoch = {dependentRoot: RootHex; dutiesByIndex: Map<ValidatorIndex, routes.validator.PtcDuty>};

export class PtcDutiesService {
  /** Maps a validator index to its PTC duty for each epoch. */
  private readonly dutiesByIndexByEpoch = new Map<Epoch, PtcDutiesAtEpoch>();

  constructor(
    private readonly config: ChainForkConfig,
    private readonly logger: LoggerVc,
    private readonly api: ApiClient,
    private readonly clock: IClock,
    private readonly validatorStore: ValidatorStore,
    chainHeadTracker: ChainHeaderTracker,
    syncingStatusTracker: SyncingStatusTracker,
    private readonly metrics: Metrics | null
  ) {
    clock.runEveryEpoch(this.runDutiesTasks);
    chainHeadTracker.runOnNewHead(this.onNewHead);
    syncingStatusTracker.runOnResynced(async (slot) => {
      // Skip on first slot of epoch since tasks are already scheduled.
      if (!isStartSlotOfEpoch(slot)) {
        return this.runDutiesTasks(computeEpochAtSlot(slot));
      }
    });

    if (metrics) {
      metrics.ptcDutiesCount.addCollect(() => {
        const currentSlot = this.clock.getCurrentSlot();
        let duties = 0;
        let nextDutySlot = null;
        for (const [epoch, ptcDutiesAtEpoch] of this.dutiesByIndexByEpoch) {
          duties += ptcDutiesAtEpoch.dutiesByIndex.size;

          // Epochs are sorted, stop searching once a next duty slot is found.
          if (epoch < this.clock.currentEpoch || nextDutySlot !== null) continue;

          for (const duty of ptcDutiesAtEpoch.dutiesByIndex.values()) {
            if (duty.slot > currentSlot && (nextDutySlot === null || duty.slot < nextDutySlot)) {
              nextDutySlot = duty.slot;
            }
          }
        }
        metrics.ptcDutiesCount.set(duties);
        metrics.ptcDutiesEpochCount.set(this.dutiesByIndexByEpoch.size);
        if (nextDutySlot !== null) metrics.ptcDutiesNextSlot.set(nextDutySlot);
      });
    }
  }

  removeDutiesForKey(pubkey: PubkeyHex): void {
    for (const [epoch, ptcDutiesAtEpoch] of this.dutiesByIndexByEpoch) {
      for (const [validatorIndex, duty] of ptcDutiesAtEpoch.dutiesByIndex) {
        if (toPubkeyHex(duty.pubkey) === pubkey) {
          ptcDutiesAtEpoch.dutiesByIndex.delete(validatorIndex);
          if (ptcDutiesAtEpoch.dutiesByIndex.size === 0) {
            this.dutiesByIndexByEpoch.delete(epoch);
          }
        }
      }
    }
  }

  /** Returns all PTC duties for the given slot. */
  getDutiesAtSlot(slot: Slot): routes.validator.PtcDuty[] {
    const epoch = computeEpochAtSlot(slot);
    const duties: routes.validator.PtcDuty[] = [];
    const epochDuties = this.dutiesByIndexByEpoch.get(epoch);
    if (epochDuties === undefined) {
      return duties;
    }

    for (const duty of epochDuties.dutiesByIndex.values()) {
      if (duty.slot === slot) {
        duties.push(duty);
      }
    }

    return duties;
  }

  private runDutiesTasks = async (epoch: Epoch): Promise<void> => {
    const nextEpoch = epoch + 1;
    if (!isForkPostGloas(this.config.getForkName(nextEpoch * SLOTS_PER_EPOCH))) {
      return;
    }

    await Promise.all([
      this.pollPtcDuties(epoch, this.validatorStore.getAllLocalIndices()).catch((e: Error) => {
        this.logger.error("Error on poll PTC duties", {epoch}, e);
      }),

      this.validatorStore
        .pollValidatorIndices()
        .then((newIndices) => this.pollPtcDuties(epoch, newIndices))
        .catch((e: Error) => {
          this.logger.error("Error on poll indices and PTC duties", {epoch}, e);
        }),
    ]);

    this.pruneOldDuties(epoch);
  };

  private async pollPtcDuties(currentEpoch: Epoch, indexArr: ValidatorIndex[]): Promise<void> {
    const nextEpoch = currentEpoch + 1;

    if (indexArr.length === 0) {
      return;
    }

    for (const epoch of [currentEpoch, nextEpoch]) {
      await this.pollPtcDutiesForEpoch(epoch, indexArr).catch((e: Error) => {
        this.logger.error("Failed to download PTC duties", {epoch}, e);
      });
    }
  }

  private async pollPtcDutiesForEpoch(epoch: Epoch, indexArr: ValidatorIndex[]): Promise<void> {
    if (epoch < 0) {
      return;
    }

    if (!isForkPostGloas(this.config.getForkName(epoch * SLOTS_PER_EPOCH))) {
      return;
    }

    const res = await this.api.validator.getPtcDuties({epoch, indices: indexArr});
    const ptcDuties = res.value();
    const {dependentRoot} = res.meta();
    const relevantDuties = ptcDuties.filter((duty) => {
      const pubkeyHex = toPubkeyHex(duty.pubkey);
      return this.validatorStore.hasVotingPubkey(pubkeyHex) && this.validatorStore.isDoppelgangerSafe(pubkeyHex);
    });

    this.logger.debug("Downloaded PTC duties", {epoch, dependentRoot, count: relevantDuties.length});

    const dutiesAtEpoch = this.dutiesByIndexByEpoch.get(epoch);
    const priorDependentRoot = dutiesAtEpoch?.dependentRoot;
    const dependentRootChanged = priorDependentRoot !== undefined && priorDependentRoot !== dependentRoot;

    if (!priorDependentRoot || dependentRootChanged) {
      const dutiesByIndex = new Map<ValidatorIndex, routes.validator.PtcDuty>();
      for (const duty of relevantDuties) {
        dutiesByIndex.set(duty.validatorIndex, duty);
      }
      this.dutiesByIndexByEpoch.set(epoch, {dependentRoot, dutiesByIndex});

      if (priorDependentRoot && dependentRootChanged) {
        this.metrics?.ptcDutiesReorg.inc();
        this.logger.warn("PTC duties re-org. This may happen from time to time", {
          priorDependentRoot,
          dependentRoot,
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
            existingDuties.set(duty.validatorIndex, duty);
          }
        }

        this.logger.debug("Discovered new PTC duties", {
          epoch,
          dependentRoot,
          count: relevantDuties.length - existingDutiesCount,
        });
      }
    }
  }

  private onNewHead = async ({
    slot,
    previousDutyDependentRoot,
    currentDutyDependentRoot,
  }: HeadEventData): Promise<void> => {
    const currentEpoch = computeEpochAtSlot(slot);
    const nextEpoch = currentEpoch + 1;

    const nextEpochDependentRoot = this.dutiesByIndexByEpoch.get(nextEpoch)?.dependentRoot;
    if (nextEpochDependentRoot && currentDutyDependentRoot !== nextEpochDependentRoot) {
      this.logger.warn("Potential next epoch PTC duties reorg", {
        slot,
        dutyEpoch: nextEpoch,
        priorDependentRoot: nextEpochDependentRoot,
        newDependentRoot: currentDutyDependentRoot,
      });
      await this.handlePtcDutiesReorg(nextEpoch, slot, nextEpochDependentRoot, currentDutyDependentRoot);
    }

    const currentEpochDependentRoot = this.dutiesByIndexByEpoch.get(currentEpoch)?.dependentRoot;
    if (currentEpochDependentRoot && currentEpochDependentRoot !== previousDutyDependentRoot) {
      this.logger.warn("Potential current epoch PTC duties reorg", {
        slot,
        dutyEpoch: currentEpoch,
        priorDependentRoot: currentEpochDependentRoot,
        newDependentRoot: previousDutyDependentRoot,
      });
      await this.handlePtcDutiesReorg(currentEpoch, slot, currentEpochDependentRoot, previousDutyDependentRoot);
    }
  };

  private async handlePtcDutiesReorg(
    dutyEpoch: Epoch,
    slot: Slot,
    oldDependentRoot: RootHex,
    newDependentRoot: RootHex
  ): Promise<void> {
    this.metrics?.ptcDutiesReorg.inc();
    const logContext = {dutyEpoch, slot, oldDependentRoot, newDependentRoot};
    this.logger.debug("Redownload PTC duties", logContext);

    await this.pollPtcDutiesForEpoch(dutyEpoch, this.validatorStore.getAllLocalIndices()).catch((e: Error) => {
      this.logger.error("Failed to redownload PTC duties when reorg happens", logContext, e);
    });
  }

  /** Run once per epoch to prune duties map. */
  private pruneOldDuties(currentEpoch: Epoch): void {
    for (const epoch of this.dutiesByIndexByEpoch.keys()) {
      if (epoch + HISTORICAL_DUTIES_EPOCHS < currentEpoch) {
        this.dutiesByIndexByEpoch.delete(epoch);
      }
    }
  }
}
