import {FAR_FUTURE_EPOCH} from "@lodestar/params";
import {BuilderIndex, Epoch, PubkeyHex} from "@lodestar/types";
import {Builder} from "@lodestar/types/gloas";
import {toPubkeyHex} from "@lodestar/utils";
import {CachedBeaconStateGloas} from "../types.js";
import {computeEpochAtSlot} from "../util/epoch.js";
import {createBuilderView} from "../util/gloas.js";

/**
 * This is to make sure we loop through builders once per block processing.
 * Note that we cannot use this across blocks/slots.
 */
export class IndexedBuilderState {
  private readonly currentEpoch: Epoch;
  private readonly indexByPubkey = new Map<PubkeyHex, BuilderIndex>();
  private readonly reusableIndiceCandidates: BuilderIndex[] = [];
  private nextCandidateIndex = 0;

  constructor(readonly state: CachedBeaconStateGloas) {
    state.builders.commit();
    const builders = state.builders.getAllReadonlyValues();
    this.currentEpoch = computeEpochAtSlot(state.slot);
    for (const [index, builder] of builders.entries()) {
      const pubkeyHex = toPubkeyHex(builder.pubkey);
      this.indexByPubkey.set(pubkeyHex, index);
      if (canReuseBuilder(builder, this.currentEpoch)) {
        this.reusableIndiceCandidates.push(index);
      }
    }
  }

  findBuilderIndexByPubkey(pubkey: Uint8Array): BuilderIndex | null {
    return this.indexByPubkey.get(toPubkeyHex(pubkey)) ?? null;
  }

  topUp(index: BuilderIndex, amount: number): void {
    const builder = this.state.builders.get(index);
    // If the builder has exited and been fully swept (balance drained to 0), reset the
    // withdrawable epoch so this top-up becomes withdrawable again. Must run before the
    // balance increase, since the reset is gated on the current balance being 0.
    if (builder.withdrawableEpoch !== FAR_FUTURE_EPOCH && builder.balance === 0) {
      builder.withdrawableEpoch = this.currentEpoch + this.state.config.MIN_BUILDER_WITHDRAWABILITY_DELAY;
    }
    builder.balance += amount;
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
    while (this.nextCandidateIndex < this.reusableIndiceCandidates.length) {
      const index = this.reusableIndiceCandidates[this.nextCandidateIndex++];
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
