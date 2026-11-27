import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {ForkName, MIN_DEPOSIT_AMOUNT, isForkPostGloas} from "@lodestar/params";
import {IClock, computeEpochAtSlot} from "@lodestar/state-transition";
import {BuilderIndex, BuilderStatus, ExecutionAddress, RootHex, Slot, gloas} from "@lodestar/types";
import {GWEI_TO_WEI, LogData, Logger, isErrorAborted, prettyGweiToEth, toHex, toRootHex} from "@lodestar/utils";
import {BidResult, Metrics} from "../metrics.js";
import {BidLedger} from "./bidLedger.js";
import {BidPolicy} from "./bidPolicy.js";
import {BidPublisher} from "./bidPublisher.js";
import {createExecutionPayloadBid} from "./executionPayloadBid.js";
import {HeadTracker} from "./headTracker.js";
import {PayloadOrchestrator} from "./payloadOrchestrator.js";
import {PayloadStore} from "./payloadStore.js";
import {ProposerPreferencesTracker} from "./proposerPreferencesTracker.js";

export type PayloadAttributesEvent = routes.events.EventData[routes.events.EventType.payloadAttributes];

export type BidderOptions = {
  /** Point within the slot before the proposal slot at which the payload is retrieved and bid on, in basis points */
  deadlineBps: number;
  /** Do not bid while the builder balance is below this value */
  minOperatingBalanceGwei: number;
};

export type BidderModules = {
  config: ChainForkConfig;
  logger: Logger;
  clock: IClock;
  api: ApiClient;
  orchestrator: PayloadOrchestrator;
  payloadStore: PayloadStore;
  ledger: BidLedger;
  policy: BidPolicy;
  bidPublisher: BidPublisher;
  proposerPreferencesTracker: ProposerPreferencesTracker;
  headTracker: HeadTracker;
  getBuilderStatus: () => {status: BuilderStatus | undefined; balance: number | undefined};
  builderIndex: BuilderIndex;
  executionFeeRecipient: ExecutionAddress;
  metrics: Metrics | null;
  signal: AbortSignal;
};

/** Maximum payload attributes kept while the proposer preferences of their slot are not known */
export const MAX_PENDING_PAYLOAD_ATTRIBUTES = 16;

/**
 * Bids once per proposal slot and parent: starts a payload build when the beacon node emits payload attributes,
 * retrieves the payload at the deadline, prices it and publishes the signed bid.
 */
export class Bidder {
  private readonly activeBuilds = new Set<string>();
  /**
   * Payload attributes of upcoming slots that could not be bid on yet, by build id. The dependent root of their
   * parent does not change, it is not resolved again as the head of the beacon node may be on another branch by then
   */
  private readonly pendingPayloadAttributes = new Map<
    string,
    {event: PayloadAttributesEvent; dependentRoot: RootHex}
  >();

  constructor(
    private readonly modules: BidderModules,
    private readonly opts: BidderOptions
  ) {}

  async onPayloadAttributes(event: PayloadAttributesEvent): Promise<void> {
    const {clock, ledger, logger, metrics, orchestrator, proposerPreferencesTracker} = this.modules;
    if (!isForkPostGloas(event.version)) {
      return;
    }
    const data = event.data as gloas.SSEPayloadAttributes;
    const slot = data.proposalSlot;
    const parentBlockRoot = toRootHex(data.parentBlockRoot);
    const parentBlockHash = toRootHex(data.parentBlockHash);
    const logCtx = {slot, parentBlockRoot, parentBlockHash};

    if (slot <= clock.getCurrentSlot()) {
      logger.debug("Ignoring payload attributes for past slot", logCtx);
      return;
    }

    // TODO: the beacon node emits payload attributes once per slot, late in the slot and only for the parent
    // payload variant it would build on, revisit to start the build earlier and to bid on both variants
    const buildId = `${slot}:${parentBlockRoot}:${parentBlockHash}`;
    if (this.activeBuilds.has(buildId) || ledger.hasSubmitted(slot, parentBlockHash, parentBlockRoot)) {
      return;
    }
    this.activeBuilds.add(buildId);

    try {
      // Heze bids require inclusion list bits which are not tracked yet
      if (event.version !== ForkName.gloas) {
        logger.warn("Bidding is not supported for fork", {...logCtx, fork: event.version});
        return;
      }

      const dependentRoot =
        this.pendingPayloadAttributes.get(buildId)?.dependentRoot ??
        (await this.getDependentRoot(parentBlockRoot, slot, logCtx));
      const proposerPreferences = proposerPreferencesTracker.get(slot, dependentRoot);
      if (proposerPreferences === null) {
        // Emitted once per parent, the proposer preferences can still arrive before the bid deadline
        if (!this.pendingPayloadAttributes.has(buildId)) {
          this.prunePendingPayloadAttributes();
          if (this.pendingPayloadAttributes.size >= MAX_PENDING_PAYLOAD_ATTRIBUTES) {
            // Oldest first, the latest payload attributes are the ones built on the current head
            const oldest = this.pendingPayloadAttributes.keys().next().value;
            if (oldest !== undefined) this.pendingPayloadAttributes.delete(oldest);
          }
          this.pendingPayloadAttributes.set(buildId, {event, dependentRoot});
          logger.debug("No proposer preferences known for slot, not bidding", {...logCtx, dependentRoot});
          metrics?.bids.total.inc({result: BidResult.noProposerPreferences});
        }
        return;
      }
      this.pendingPayloadAttributes.delete(buildId);
      const {feeRecipient, targetGasLimit} = proposerPreferences.message;

      const msToDeadline = this.getMsToDeadline(slot);
      logger.verbose("Preparing payload build", {...logCtx, msToDeadline, targetGasLimit});

      const payload = await orchestrator.run({
        id: buildId,
        request: {
          fork: event.version,
          forkchoiceState: {
            headBlockHash: parentBlockHash,
            safeBlockHash: toRootHex(data.safeBlockHash),
            finalizedBlockHash: toRootHex(data.finalizedBlockHash),
          },
          payloadAttributes: {
            ...data.payloadAttributes,
            suggestedFeeRecipient: toHex(this.modules.executionFeeRecipient),
            targetGasLimit,
          },
        },
        getPayloadAt: Date.now() + msToDeadline,
      });

      if (this.modules.headTracker.isHeadOptimistic()) {
        logger.warn("Beacon node head is optimistic, not bidding", logCtx);
        metrics?.bids.total.inc({result: BidResult.optimisticHead});
        return;
      }

      const {status, balance} = this.modules.getBuilderStatus();
      if (status !== "active" || balance === undefined) {
        logger.warn("Builder is not active, not bidding", {...logCtx, status});
        metrics?.bids.total.inc({result: BidResult.inactive});
        return;
      }
      if (balance < this.opts.minOperatingBalanceGwei) {
        logger.warn("Builder balance below operating minimum, not bidding", {
          ...logCtx,
          balance: prettyGweiToEth(balance),
          minOperatingBalance: prettyGweiToEth(this.opts.minOperatingBalanceGwei),
        });
        metrics?.bids.total.inc({result: BidResult.lowBalance});
        return;
      }

      const unsettledGwei = ledger.getUnsettledValueGwei(computeEpochAtSlot(slot));
      const coverableGwei = Math.max(balance - MIN_DEPOSIT_AMOUNT - unsettledGwei, 0);
      const payloadValueGwei = Number(payload.executionPayloadValue / GWEI_TO_WEI);
      const value = this.modules.policy.computeValue({payloadValueGwei, coverableGwei});
      if (value === null) {
        logger.info("Bid policy declined to bid", {...logCtx, payloadValueGwei, coverableGwei, unsettledGwei});
        metrics?.bids.total.inc({result: BidResult.policyDeclined});
        return;
      }

      const {executionPayload} = payload;
      const blockHash = toRootHex(executionPayload.blockHash);
      this.modules.payloadStore.add({slot, parentBlockRoot: data.parentBlockRoot, blockHash, payload});

      const bid = createExecutionPayloadBid({
        slot,
        parentBlockRoot: data.parentBlockRoot,
        prevRandao: data.payloadAttributes.prevRandao,
        builderIndex: this.modules.builderIndex,
        feeRecipient,
        value,
        payload: {...payload, fork: ForkName.gloas},
      });
      await this.modules.bidPublisher.publish(bid, this.modules.signal);

      metrics?.bids.total.inc({result: BidResult.published});
      logger.info("Published execution payload bid", {
        ...logCtx,
        blockHash,
        value: prettyGweiToEth(value),
        payloadValue: prettyGweiToEth(payloadValueGwei),
        feeRecipient: toHex(feeRecipient),
        gasLimit: executionPayload.gasLimit,
        transactions: executionPayload.transactions.length,
        blobs: bid.blobKzgCommitments.length,
        secFromSlot: clock.secFromSlot(slot),
      });
    } catch (e) {
      if (!isErrorAborted(e)) {
        metrics?.bids.total.inc({result: BidResult.error});
        logger.error("Failed to bid", logCtx, e as Error);
      }
    } finally {
      this.activeBuilds.delete(buildId);
    }
  }

  /**
   * Bids on the payload attributes that were emitted before the proposer preferences of their slot were known.
   * Called with the slot of new proposer preferences, or without a slot if preferences of several slots were added.
   */
  async onProposerPreferences(slot?: Slot): Promise<void> {
    this.prunePendingPayloadAttributes();
    const events: PayloadAttributesEvent[] = [];
    for (const {event} of this.pendingPayloadAttributes.values()) {
      if (slot === undefined || event.data.proposalSlot === slot) {
        events.push(event);
      }
    }

    // Stays pending if the preferences are for another dependent root
    await Promise.all(events.map((event) => this.onPayloadAttributes(event)));
  }

  /** Drops the pending payload attributes of slots that can no longer be bid on, their bid deadline has passed */
  private prunePendingPayloadAttributes(): void {
    for (const [buildId, {event}] of this.pendingPayloadAttributes) {
      if (this.getMsToDeadline(event.data.proposalSlot) <= 0) {
        this.pendingPayloadAttributes.delete(buildId);
      }
    }
  }

  /** Time in milliseconds until the bid deadline of a proposal slot, negative once it has passed */
  private getMsToDeadline(slot: Slot): number {
    const {clock, config} = this.modules;
    // The payload is retrieved in the slot before the proposal slot, use the timing of that slot
    const buildFork = config.getForkName(slot - 1);
    return (
      clock.msToSlot(slot) -
      config.getSlotDurationMs(buildFork) +
      config.getSlotComponentDurationMs(buildFork, this.opts.deadlineBps)
    );
  }

  /**
   * Dependent root of the proposer duties for the proposal slot on the branch of the parent block, identifies
   * the proposer preferences to bid against. Taken from the head events. A parent that was not announced as
   * head, e.g. before the first head event after connecting, falls back to the proposer duties, which carry
   * the dependent root of the beacon node's head branch.
   */
  private async getDependentRoot(parentBlockRoot: RootHex, slot: Slot, logCtx: LogData): Promise<RootHex> {
    const {api, headTracker, logger, signal} = this.modules;
    const dependentRoot = headTracker.getDependentRoot(parentBlockRoot, slot);
    if (dependentRoot !== null) {
      return dependentRoot;
    }

    logger.debug("Parent block is not a tracked head, fetching proposer duties for dependent root", logCtx);
    const duties = await api.validator.getProposerDutiesV2({epoch: computeEpochAtSlot(slot)}, {signal});
    return duties.meta().dependentRoot;
  }
}
