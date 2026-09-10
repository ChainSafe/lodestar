import {ApiClient, routes} from "@lodestar/api";
import type {RootHex, Slot, gloas} from "@lodestar/types";
import {Logger, MapDef, toRootHex} from "@lodestar/utils";

/** Retains validated proposer preferences by the branch-specific identity used for bid validation. */
export class ProposerPreferencesTracker {
  private readonly byDependentRootBySlot = new MapDef<Slot, Map<RootHex, gloas.SignedProposerPreferences>>(
    () => new Map()
  );

  constructor(
    private readonly api: ApiClient,
    private readonly logger: Logger
  ) {}

  start(signal: AbortSignal): void {
    if (signal.aborted) return;

    this.logger.verbose("Subscribing to proposer preferences");
    this.api.events
      .eventstream({
        topics: [routes.events.EventType.proposerPreferences],
        signal,
        onEvent: (event) => {
          if (!signal.aborted && event.type === routes.events.EventType.proposerPreferences) {
            this.onProposerPreferences(event.message.data);
          }
        },
        onError: (error) => {
          if (!signal.aborted) this.logger.error("Failed to receive proposer preferences", {}, error);
        },
        onClose: () => {
          if (signal.aborted) {
            this.logger.verbose("Closed proposer preferences stream");
          } else {
            this.logger.error("Proposer preferences stream closed unexpectedly", {});
          }
        },
      })
      .catch((error: Error) => {
        if (!signal.aborted) this.logger.error("Failed to subscribe to proposer preferences", {}, error);
      });
  }

  onProposerPreferences(signedProposerPreferences: gloas.SignedProposerPreferences): boolean {
    const {proposalSlot, dependentRoot} = signedProposerPreferences.message;
    const dependentRootHex = toRootHex(dependentRoot);
    const byDependentRoot = this.byDependentRootBySlot.getOrDefault(proposalSlot);

    if (byDependentRoot.has(dependentRootHex)) {
      return false;
    }

    byDependentRoot.set(dependentRootHex, signedProposerPreferences);
    return true;
  }

  /** Returns retained preferences; callers must not mutate them. */
  get(slot: Slot, dependentRoot: RootHex): gloas.SignedProposerPreferences | null {
    return this.byDependentRootBySlot.get(slot)?.get(dependentRoot) ?? null;
  }

  prune(currentSlot: Slot): number {
    let removed = 0;
    for (const [slot, byDependentRoot] of this.byDependentRootBySlot) {
      if (slot >= currentSlot) {
        continue;
      }

      removed += byDependentRoot.size;
      this.byDependentRootBySlot.delete(slot);
    }
    return removed;
  }
}
