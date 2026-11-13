import {BuilderIndex, Epoch, PubkeyHex} from "@lodestar/types";
import {Builder} from "@lodestar/types/gloas";
import {toPubkeyHex} from "@lodestar/utils";
import {CachedBeaconStateGloas} from "../types.js";
import {computeEpochAtSlot} from "../util/epoch.js";
import {createBuilderView} from "../util/gloas.js";

/**
 * Block-scoped pubkey -> index map and ascending reuse candidates for `state.builders`, built in one pass.
 * Only valid while builder pubkeys change exclusively via `addBuilderToRegistry()` and no builder becomes
 * newly reusable (candidates are re-checked lazily, never added). Do not use across blocks/slots.
 */
export class IndexedBuilderState {
  private readonly currentEpoch: Epoch;
  private readonly indexByPubkey = new Map<PubkeyHex, BuilderIndex>();
  private readonly reusableIndexCandidates: BuilderIndex[] = [];
  private candidateCursor = 0;

  constructor(readonly state: CachedBeaconStateGloas) {
    state.builders.commit();
    const builders = state.builders.getAllReadonlyValues();
    this.currentEpoch = computeEpochAtSlot(state.slot);
    for (const [index, builder] of builders.entries()) {
      const pubkeyHex = toPubkeyHex(builder.pubkey);
      this.indexByPubkey.set(pubkeyHex, index);
      if (canReuseBuilder(builder, this.currentEpoch)) {
        this.reusableIndexCandidates.push(index);
      }
    }
  }

  findBuilderIndexByPubkey(pubkey: Uint8Array): BuilderIndex | null {
    return this.indexByPubkey.get(toPubkeyHex(pubkey)) ?? null;
  }

  addBuilderToRegistry(pubkey: Uint8Array, version: number, executionAddress: Uint8Array, amount: number): void {
    const builder = createBuilderView(pubkey, version, executionAddress, amount, this.currentEpoch);
    const reusableIndex = this.findReusableBuilderIndex();
    const index = reusableIndex ?? this.state.builders.length;
    if (reusableIndex !== null) {
      const oldBuilder = this.state.builders.getReadonly(index);
      this.indexByPubkey.delete(toPubkeyHex(oldBuilder.pubkey));
      this.state.builders.set(index, builder);
    } else {
      this.state.builders.push(builder);
    }
    this.indexByPubkey.set(toPubkeyHex(pubkey), index);
  }

  private findReusableBuilderIndex(): BuilderIndex | null {
    while (this.candidateCursor < this.reusableIndexCandidates.length) {
      const index = this.reusableIndexCandidates[this.candidateCursor++];
      const builder = this.state.builders.getReadonly(index);
      // Top-ups can invalidate initial candidates
      if (canReuseBuilder(builder, this.currentEpoch)) {
        return index;
      }
    }
    return null;
  }
}

function canReuseBuilder(builder: Builder, currentEpoch: Epoch): boolean {
  return builder.withdrawableEpoch <= currentEpoch && builder.balance === 0;
}
