import {persistDiff} from "@lodestar/db";
import type {RootHex, Slot, gloas} from "@lodestar/types";
import {MapDef, toHex, toRootHex} from "@lodestar/utils";
import type {ProposerPreferencesRepository} from "../repositories/proposerPreferences.js";

/** Retains validated proposer preferences by the branch-specific identity used for bid validation. */
export class ProposerPreferencesTracker {
  private readonly byDependentRootBySlot = new MapDef<Slot, Map<RootHex, gloas.SignedProposerPreferences>>(
    () => new Map()
  );

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

  get(slot: Slot, dependentRoot: RootHex): gloas.SignedProposerPreferences | null {
    return this.byDependentRootBySlot.get(slot)?.get(dependentRoot) ?? null;
  }

  getAll(): gloas.SignedProposerPreferences[] {
    const preferences: gloas.SignedProposerPreferences[] = [];
    for (const byDependentRoot of this.byDependentRootBySlot.values()) {
      preferences.push(...byDependentRoot.values());
    }
    return preferences;
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

  /** Restore the preferences of upcoming slots, they were validated by the beacon node before they were persisted */
  async fromPersisted(repo: ProposerPreferencesRepository, currentSlot: Slot): Promise<void> {
    for (const signedProposerPreferences of await repo.values()) {
      if (signedProposerPreferences.message.proposalSlot >= currentSlot) {
        this.onProposerPreferences(signedProposerPreferences);
      }
    }
  }

  async toPersisted(repo: ProposerPreferencesRepository): Promise<void> {
    await persistDiff(
      repo,
      this.getAll().map((signed) => ({key: repo.getId(signed), value: signed})),
      toHex
    );
  }
}
