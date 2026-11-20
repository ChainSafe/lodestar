import {ApiClient, routes} from "@lodestar/api";
import {IClock, computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot} from "@lodestar/types";

type EpochProposers = {
  fetchedAtEpoch: Epoch;
  dependentRoot: RootHex;
  bySlot: Map<Slot, routes.validator.ProposerDuty>;
};

/** Resolves the proposer of a slot from the proposer duties of the beacon node */
export class ProposerDutiesTracker {
  private readonly proposersByEpoch = new Map<Epoch, EpochProposers>();
  private readonly generations = new Map<Epoch, object>();
  private readonly pending = new Map<
    Epoch,
    {fetchedAtEpoch: Epoch; generation: object; result: Promise<EpochProposers>}
  >();

  constructor(
    private readonly api: ApiClient,
    private readonly clock: IClock
  ) {}

  /** Installs duties fetched for the current authoritative primary branch. */
  update(epoch: Epoch, dependentRoot: RootHex, duties: routes.validator.ProposerDuty[]): void {
    this.invalidate(epoch);
    const currentEpoch = this.clock.getCurrentEpoch();
    if (epoch < currentEpoch || epoch > currentEpoch + 1) return;
    this.proposersByEpoch.set(epoch, {
      fetchedAtEpoch: currentEpoch,
      dependentRoot,
      bySlot: new Map(duties.map((duty) => [duty.slot, duty])),
    });
    this.prune();
  }

  /** Discards cached and pending duties before refreshing the authoritative branch. */
  invalidate(epoch: Epoch): void {
    this.proposersByEpoch.delete(epoch);
    this.pending.delete(epoch);
    this.generations.delete(epoch);
  }

  /** Returns null for slots outside of the current and next epoch */
  async getProposer(slot: Slot): Promise<routes.validator.ProposerDuty | null> {
    const epoch = computeEpochAtSlot(slot);
    while (true) {
      const currentEpoch = this.clock.getCurrentEpoch();
      if (epoch < currentEpoch || epoch > currentEpoch + 1) return null;

      const proposers = this.proposersByEpoch.get(epoch);
      // Duties fetched one epoch ahead are fetched again once their epoch started.
      if (proposers && proposers.fetchedAtEpoch >= currentEpoch) return proposers.bySlot.get(slot) ?? null;

      let pending = this.pending.get(epoch);
      if (!pending || pending.fetchedAtEpoch < currentEpoch) {
        const generation = {};
        const result = this.api.validator.getProposerDutiesV2({epoch}).then((response) => ({
          fetchedAtEpoch: currentEpoch,
          dependentRoot: response.meta().dependentRoot,
          bySlot: new Map(response.value().map((duty) => [duty.slot, duty])),
        }));
        pending = {fetchedAtEpoch: currentEpoch, generation, result};
        this.pending.set(epoch, pending);
        this.generations.set(epoch, generation);
      }
      try {
        const fetched = await pending.result;
        // A primary update or newer lookup invalidates both the old result and its error.
        if (this.generations.get(epoch) !== pending.generation) continue;
        this.proposersByEpoch.set(epoch, fetched);
        this.prune();
      } catch (error) {
        if (this.generations.get(epoch) !== pending.generation) continue;
        throw error;
      } finally {
        if (this.pending.get(epoch) === pending) this.pending.delete(epoch);
      }
    }
  }

  private prune(): void {
    for (const epoch of this.proposersByEpoch.keys()) {
      if (epoch < this.clock.getCurrentEpoch()) this.proposersByEpoch.delete(epoch);
    }
    for (const epoch of this.generations.keys()) {
      if (epoch < this.clock.getCurrentEpoch()) this.generations.delete(epoch);
    }
  }
}
