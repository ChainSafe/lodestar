import {ApiClient, routes} from "@lodestar/api";
import {IClock, computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {HeadEvent} from "./headTracker.js";

type EpochProposers = {
  /** Dependent root the duties were fetched for, they are fetched again if a head reports another one */
  dependentRoot: RootHex;
  bySlot: Map<Slot, routes.validator.ProposerDuty>;
};

/** Resolves the proposer of a slot from the proposer duties of the beacon node */
export class ProposerDutiesTracker {
  private readonly proposersByEpoch = new Map<Epoch, EpochProposers>();
  /** Fetches in progress, shared by all callers that need the duties of the same epoch */
  private readonly fetchesByEpoch = new Map<Epoch, Promise<EpochProposers>>();

  constructor(
    private readonly api: ApiClient,
    private readonly clock: IClock,
    private readonly logger: Logger
  ) {}

  /**
   * Fetches the duties of the epoch and the one after it, to be called once the epoch started.
   * Requests of proposers then find their duties cached and do not have to fetch them.
   */
  async prefetch(epoch: Epoch): Promise<void> {
    await Promise.all(
      [epoch, epoch + 1].map(async (fetchEpoch) => {
        if (this.proposersByEpoch.has(fetchEpoch)) {
          return;
        }
        try {
          await this.fetchProposers(fetchEpoch);
        } catch (e) {
          this.logger.warn("Failed to prefetch proposer duties", {epoch: fetchEpoch}, e as Error);
        }
      })
    );
  }

  /**
   * Returns null for slots outside of the previous, current and next epoch.
   * The previous epoch is only resolved from the duties that were cached while it was the current epoch,
   * this covers requests for its last slots that arrive after the epoch ended.
   */
  async getProposer(slot: Slot): Promise<routes.validator.ProposerDuty | null> {
    const epoch = computeEpochAtSlot(slot);
    const currentEpoch = this.clock.getCurrentEpoch();
    if (epoch < currentEpoch - 1 || epoch > currentEpoch + 1) {
      return null;
    }

    let proposers = this.proposersByEpoch.get(epoch);
    if (proposers === undefined) {
      if (epoch < currentEpoch) {
        return null;
      }
      proposers = await this.fetchProposers(epoch);
    }
    return proposers.bySlot.get(slot) ?? null;
  }

  /**
   * Fetches the cached duties of an epoch again if the head reports another dependent root for them,
   * e.g. after a reorg. This keeps the cache correct without fetching duties for every request.
   */
  onHead({slot, currentEpochDependentRoot, nextEpochDependentRoot}: HeadEvent["data"]): void {
    const epoch = computeEpochAtSlot(slot);
    this.refetchIfChanged(epoch, currentEpochDependentRoot);
    this.refetchIfChanged(epoch + 1, nextEpochDependentRoot);
  }

  private refetchIfChanged(epoch: Epoch, dependentRoot: RootHex): void {
    const proposers = this.proposersByEpoch.get(epoch);
    if (proposers === undefined || proposers.dependentRoot === dependentRoot) {
      return;
    }
    // The duties of an epoch that ended are only kept for late requests
    if (epoch < this.clock.getCurrentEpoch()) {
      return;
    }

    // The cached duties are kept if this fails, the next head triggers another attempt
    this.fetchProposers(epoch).catch((e) => {
      this.logger.warn("Failed to refetch proposer duties", {epoch, dependentRoot}, e as Error);
    });
  }

  private fetchProposers(epoch: Epoch): Promise<EpochProposers> {
    let fetch = this.fetchesByEpoch.get(epoch);
    if (fetch === undefined) {
      fetch = this.fetchAndCacheProposers(epoch).finally(() => this.fetchesByEpoch.delete(epoch));
      this.fetchesByEpoch.set(epoch, fetch);
    }
    return fetch;
  }

  private async fetchAndCacheProposers(epoch: Epoch): Promise<EpochProposers> {
    const res = await this.api.validator.getProposerDutiesV2({epoch});
    const proposers: EpochProposers = {
      dependentRoot: res.meta().dependentRoot,
      bySlot: new Map(res.value().map((duty) => [duty.slot, duty])),
    };
    this.proposersByEpoch.set(epoch, proposers);

    // The previous epoch is kept for requests that arrive after it ended
    const currentEpoch = this.clock.getCurrentEpoch();
    for (const cachedEpoch of this.proposersByEpoch.keys()) {
      if (cachedEpoch < currentEpoch - 1) {
        this.proposersByEpoch.delete(cachedEpoch);
      }
    }
    return proposers;
  }
}
