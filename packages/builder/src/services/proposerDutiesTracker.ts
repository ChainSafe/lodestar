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

  constructor(
    private readonly api: ApiClient,
    private readonly clock: IClock,
    private readonly logger: Logger
  ) {}

  /** Returns null for slots outside of the current and next epoch */
  async getProposer(slot: Slot): Promise<routes.validator.ProposerDuty | null> {
    const epoch = computeEpochAtSlot(slot);
    const currentEpoch = this.clock.getCurrentEpoch();
    if (epoch < currentEpoch || epoch > currentEpoch + 1) {
      return null;
    }

    const proposers = this.proposersByEpoch.get(epoch) ?? (await this.fetchProposers(epoch));
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

    // The cached duties are kept if this fails, the next head triggers another attempt
    this.fetchProposers(epoch).catch((e) => {
      this.logger.warn("Failed to refetch proposer duties", {epoch, dependentRoot}, e as Error);
    });
  }

  private async fetchProposers(epoch: Epoch): Promise<EpochProposers> {
    const res = await this.api.validator.getProposerDutiesV2({epoch});
    const proposers: EpochProposers = {
      dependentRoot: res.meta().dependentRoot,
      bySlot: new Map(res.value().map((duty) => [duty.slot, duty])),
    };
    this.proposersByEpoch.set(epoch, proposers);

    const currentEpoch = this.clock.getCurrentEpoch();
    for (const cachedEpoch of this.proposersByEpoch.keys()) {
      if (cachedEpoch < currentEpoch) {
        this.proposersByEpoch.delete(cachedEpoch);
      }
    }
    return proposers;
  }
}
