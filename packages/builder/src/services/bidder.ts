import {ApiClient, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {ForkName, MIN_DEPOSIT_AMOUNT, isForkPostGloas} from "@lodestar/params";
import {IClock, computeEpochAtSlot} from "@lodestar/state-transition";
import {BuilderIndex, BuilderStatus, Epoch, ExecutionAddress, RootHex, gloas} from "@lodestar/types";
import {GWEI_TO_WEI, LodestarError, Logger, isErrorAborted, prettyGweiToEth, toHex, toRootHex} from "@lodestar/utils";
import {BidResult, Metrics} from "../metrics.js";
import {BidLedger} from "./bidLedger.js";
import {BidPolicy} from "./bidPolicy.js";
import {BidPublisher} from "./bidPublisher.js";
import {createExecutionPayloadBid} from "./executionPayloadBid.js";
import {PayloadOrchestrator} from "./payloadOrchestrator.js";
import {PayloadStore} from "./payloadStore.js";
import {ProposerPreferencesTracker} from "./proposerPreferencesTracker.js";

const MAX_PENDING_ATTRIBUTES = 32;

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
  createOrchestrator: (signal: AbortSignal) => PayloadOrchestrator;
  payloadStore: PayloadStore;
  ledger: BidLedger;
  policy: BidPolicy;
  bidPublisher: BidPublisher;
  proposerPreferencesTracker: ProposerPreferencesTracker;
  getBuilderStatus: () => {status: BuilderStatus | undefined; balance: number | undefined};
  builderIndex: BuilderIndex;
  executionFeeRecipient: ExecutionAddress;
  metrics: Metrics | null;
  signal: AbortSignal;
};

/**
 * Bids once per proposal slot and parent: starts a payload build when the beacon node emits payload attributes,
 * retrieves the payload at the deadline, prices it and publishes the signed bid.
 */
export class Bidder {
  private readonly activeBuilds = new Set<string>();
  private readonly pendingAttributes = new Map<string, PayloadAttributesEvent>();
  private controller = new AbortController();
  private generation = 0;
  private orchestrator: PayloadOrchestrator;

  constructor(
    private readonly modules: BidderModules,
    private readonly opts: BidderOptions
  ) {
    this.orchestrator = modules.createOrchestrator(this.controller.signal);
    modules.signal.addEventListener("abort", () => this.controller.abort(), {once: true});
    if (modules.signal.aborted) this.controller.abort();
  }

  invalidateInputs(): void {
    this.controller.abort();
    this.controller = new AbortController();
    if (this.modules.signal.aborted) this.controller.abort();
    this.orchestrator = this.modules.createOrchestrator(this.controller.signal);
    this.generation++;
    this.activeBuilds.clear();
    this.pendingAttributes.clear();
  }

  async onPreferences(): Promise<void> {
    const events = [...this.pendingAttributes.values()];
    this.pendingAttributes.clear();
    await Promise.all(events.map((event) => this.onPayloadAttributes(event)));
  }

  async onPayloadAttributes(event: PayloadAttributesEvent): Promise<void> {
    const {clock, config, ledger, logger, metrics, proposerPreferencesTracker} = this.modules;
    const orchestrator = this.orchestrator;
    const generation = this.generation;
    const signal = this.controller.signal;
    if (signal.aborted) return;
    if (!isForkPostGloas(event.version)) {
      return;
    }
    const data = event.data as gloas.SSEPayloadAttributes;
    const slot = data.proposalSlot;
    for (const [key, pending] of this.pendingAttributes) {
      if (pending.data.proposalSlot <= clock.getCurrentSlot()) this.pendingAttributes.delete(key);
    }
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

      if (
        data.payloadAttributes.slotNumber !== slot ||
        toRootHex(data.payloadAttributes.parentBeaconBlockRoot) !== parentBlockRoot
      ) {
        throw new LodestarError({code: "BIDDER_ERROR_INCONSISTENT_ATTRIBUTES", slot, parentBlockRoot});
      }

      const dependentRoot = await this.getDependentRoot(computeEpochAtSlot(slot), signal);
      signal.throwIfAborted();
      const proposerPreferences = proposerPreferencesTracker.get(slot, dependentRoot);
      if (proposerPreferences === null) {
        if (this.pendingAttributes.size < MAX_PENDING_ATTRIBUTES) this.pendingAttributes.set(buildId, event);
        logger.debug("No proposer preferences known for slot, not bidding", {...logCtx, dependentRoot});
        metrics?.bids.total.inc({result: BidResult.noProposerPreferences});
        return;
      }
      const {feeRecipient, targetGasLimit} = proposerPreferences.message;

      // The payload is retrieved in the slot before the proposal slot, use the timing of that slot
      const buildFork = config.getForkName(slot - 1);
      const msToDeadline =
        clock.msToSlot(slot) -
        config.getSlotDurationMs(buildFork) +
        config.getSlotComponentDurationMs(buildFork, this.opts.deadlineBps);
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

      const {status, balance} = this.modules.getBuilderStatus();
      signal.throwIfAborted();
      if (payload.fork !== event.version || toRootHex(payload.executionPayload.parentHash) !== parentBlockHash) {
        throw new LodestarError({code: "BIDDER_ERROR_PAYLOAD_MISMATCH", slot, parentBlockHash});
      }
      if (status !== "active" || balance === undefined) {
        logger.warn("Builder is not active, not bidding", {...logCtx, status});
        metrics?.bids.total.inc({result: BidResult.inactive});
        return;
      }
      if (!Number.isSafeInteger(balance) || balance < 0) {
        throw new LodestarError({code: "BIDDER_ERROR_INVALID_BALANCE", balance});
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
      const availableGwei = Math.max(balance - unsettledGwei, 0);
      const coverableGwei = Math.max(availableGwei - MIN_DEPOSIT_AMOUNT, 0);
      if (
        payload.executionPayloadValue < 0n ||
        payload.executionPayloadValue / GWEI_TO_WEI > BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        throw new LodestarError({code: "BIDDER_ERROR_UNSAFE_PAYLOAD_VALUE", slot});
      }
      const payloadValueGwei = Number(payload.executionPayloadValue / GWEI_TO_WEI);
      const value = this.modules.policy.computeValue({payloadValueGwei, coverableGwei});
      if (value === null) {
        logger.info("Bid policy declined to bid", {...logCtx, payloadValueGwei, coverableGwei, unsettledGwei});
        metrics?.bids.total.inc({result: BidResult.policyDeclined});
        return;
      }

      const {executionPayload} = payload;
      const blockHash = toRootHex(executionPayload.blockHash);

      const bid = createExecutionPayloadBid({
        slot,
        parentBlockRoot: data.parentBlockRoot,
        prevRandao: data.payloadAttributes.prevRandao,
        builderIndex: this.modules.builderIndex,
        feeRecipient,
        value,
        payload: {...payload, fork: ForkName.gloas},
      });
      if (value > coverableGwei) {
        throw new LodestarError({code: "BIDDER_ERROR_UNCOVERED_BID", value, coverableGwei});
      }
      this.modules.payloadStore.add({slot, parentBlockRoot: data.parentBlockRoot, blockHash, payload});
      await this.modules.bidPublisher.publish(bid, signal);

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
      if (!signal.aborted && !isErrorAborted(e)) {
        metrics?.bids.total.inc({result: BidResult.error});
        logger.error("Failed to bid", logCtx, e as Error);
      }
    } finally {
      if (generation === this.generation) this.activeBuilds.delete(buildId);
    }
  }

  /**
   * Dependent root of the proposer duties in the given epoch, identifies the proposer preferences to bid against.
   * Not cached, a reorg can change the dependent root within an epoch. Active builds already coalesce repeated attributes.
   */
  private async getDependentRoot(epoch: Epoch, signal: AbortSignal): Promise<RootHex> {
    return (await this.modules.api.validator.getProposerDutiesV2({epoch}, {signal})).meta().dependentRoot;
  }
}
