import {routes} from "@lodestar/api";
import {
  PayloadStatus,
  ProtoBlock,
  getFinalizedExecutionBlockHash,
  getSafeExecutionBlockHash,
} from "@lodestar/fork-choice";
import {ForkPostBellatrix, SLOTS_PER_EPOCH, isForkPostGloas} from "@lodestar/params";
import {IBeaconStateViewBellatrix, isStatePostGloas} from "@lodestar/state-transition";
import {Bytes32, Slot} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import type {BeaconChain} from "./chain.js";
import {getPayloadAttributesForSSE} from "./produceBlock/produceBlockBody.js";
import {RegenCaller} from "./regen/index.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export enum PayloadAttributesVariant {
  /** Build on the head's own payload */
  full = "full",
  /** Build on the head's parent payload, i.e. as if the head payload was not delivered */
  empty = "empty",
}

/**
 * Emit a `payload_attributes` event for the next proposal slot on top of `head`, for one parent
 * payload variant. Post-gloas the variant the next proposer builds on is only known at the end of
 * the slot, so emit the empty variant as soon as a block becomes head and the full variant as soon
 * as the head payload is imported. Builders can start building on either parent right away.
 *
 * Complements the per-slot emission in PrepareNextSlotScheduler, which emits the variant the local
 * node would build on.
 */
export async function emitPayloadAttributesForHead(
  this: BeaconChain,
  head: ProtoBlock,
  variant: PayloadAttributesVariant
): Promise<void> {
  if (this.opts.emitPayloadAttributes !== true) {
    return;
  }
  if (this.emitter.listenerCount(routes.events.EventType.payloadAttributes) === 0) {
    return;
  }

  const prepareSlot = Math.max(head.slot, this.clock.currentSlot) + 1;
  const fork = this.config.getForkName(prepareSlot);
  if (!isForkPostGloas(fork)) {
    return;
  }
  // Head is too far behind, node is likely syncing
  if (prepareSlot - head.slot > SLOTS_PER_EPOCH) {
    return;
  }
  if (variant === PayloadAttributesVariant.full && head.payloadStatus !== PayloadStatus.FULL) {
    return;
  }

  const state = await this.regen.getBlockSlotState(
    head,
    prepareSlot,
    {dontTransferCache: true},
    RegenCaller.emitPayloadAttributes
  );
  if (!isStatePostGloas(state)) {
    throw new Error(`Expected gloas state for payload attributes, got fork=${state.forkName}`);
  }

  let parentBlockHash: Bytes32;
  let prepareState: IBeaconStateViewBellatrix = state;
  if (variant === PayloadAttributesVariant.full) {
    parentBlockHash = state.latestExecutionPayloadBid.blockHash;
    const parentExecutionRequests = await this.getParentExecutionRequests(head.slot, head.blockRoot);
    prepareState = state.withParentPayloadApplied(parentExecutionRequests);
  } else {
    parentBlockHash = state.latestExecutionPayloadBid.parentBlockHash;
  }

  const proposerIndex = state.getBeaconProposer(prepareSlot);
  const feeRecipient = this.beaconProposerCache.get(proposerIndex) ?? ZERO_ADDRESS;

  const data = getPayloadAttributesForSSE(fork as ForkPostBellatrix, this, {
    prepareState,
    prepareSlot,
    parentBlockRoot: fromHex(head.blockRoot),
    parentBlockHash,
    feeRecipient,
  });

  const event: routes.events.EventData[routes.events.EventType.payloadAttributes] = {
    version: fork,
    data,
    safeBlockHash: getSafeExecutionBlockHash(this.forkChoice, this.logger),
    finalizedBlockHash: getFinalizedExecutionBlockHash(this.forkChoice),
  };
  this.emitter.emit(routes.events.EventType.payloadAttributes, event);

  this.logger.verbose("Emitted payload attributes", {
    prepareSlot,
    variant,
    headSlot: head.slot,
    headRoot: head.blockRoot,
  });
}

/** Fire-and-forget wrapper for import paths, errors are logged and never propagate to the importer */
export function emitPayloadAttributesForHeadAsync(
  this: BeaconChain,
  head: ProtoBlock,
  variant: PayloadAttributesVariant,
  slot: Slot
): void {
  emitPayloadAttributesForHead.call(this, head, variant).catch((e) => {
    this.logger.debug("Error emitting payload attributes", {slot, variant, headRoot: head.blockRoot}, e as Error);
  });
}
