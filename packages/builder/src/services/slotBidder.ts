import {ApiClient, routes} from "@lodestar/api";
import {PayloadAttributes} from "@lodestar/beacon-node/execution";
import {BeaconConfig} from "@lodestar/config";
import {ForkName, ForkPostGloas, MIN_DEPOSIT_AMOUNT, isForkPostGloas} from "@lodestar/params";
import {IClock, computeEpochAtSlot} from "@lodestar/state-transition";
import {BuilderIndex, BuilderStatus, ExecutionAddress, Root, RootHex, Slot, gloas, sszTypesFor} from "@lodestar/types";
import {Logger, sleep, toHex, toRootHex} from "@lodestar/utils";
import {Metrics} from "../metrics.js";
import {BidPolicy} from "./bidPolicy.js";
import {BuilderSigner} from "./builderSigner.js";
import {Ledger} from "./ledger.js";
import {BuildHandle, BuildRequest, BuiltPayload, PayloadSource} from "./payloadSource.js";
import {PayloadStore} from "./payloadStore.js";
import {ProposerPreferencesTracker} from "./proposerPreferencesTracker.js";

const ZERO_HASH_HEX = "0x" + "00".repeat(32);
const GWEI_TO_WEI = 1_000_000_000n;

export type SlotBidderOpts = {
  /** Point within the slot before the target slot at which payloads are fetched and bids published, in basis points */
  deadlineBps: number;
  /** Interval between attempts to start a build while the execution client is still syncing the parent */
  prepareRetryMs: number;
  /** Time budget for fetching payloads from all sources at the deadline */
  getPayloadTimeoutMs: number;
  /** Do not bid while the builder balance is below this, leaves headroom above the minimum */
  minOperatingBalanceGwei: number;
};

export type SlotBidderModules = {
  config: BeaconConfig;
  logger: Logger;
  clock: IClock;
  api: ApiClient;
  signer: BuilderSigner;
  sources: PayloadSource[];
  store: PayloadStore;
  policy: BidPolicy;
  ledger: Ledger;
  preferences: ProposerPreferencesTracker;
  getBuilderStatus: () => {status: BuilderStatus | undefined; balance: number | undefined};
  builderIndex: BuilderIndex;
  executionFeeRecipient: ExecutionAddress;
  metrics: Metrics | null;
};

type VariantBuild = {
  parentBlockRoot: Root;
  parentBlockRootHex: RootHex;
  parentBlockHash: RootHex;
  request: BuildRequest;
  handles: Map<string, BuildHandle>;
};

type SlotState = {
  slot: Slot;
  fork: ForkName;
  /** Builds keyed by parent block hash, one per parent payload variant */
  variants: Map<RootHex, VariantBuild>;
  /** Unix time in ms at which payloads are fetched and bids are published */
  deadlineMs: number;
  deadlineTimer: NodeJS.Timeout;
  done: boolean;
};

export type PayloadAttributesEvent = routes.events.EventData[routes.events.EventType.payloadAttributes];

/**
 * Bids for one target slot at a time: starts a build on every payload source as soon as the beacon
 * node emits payload attributes for a parent variant, then at the deadline fetches the payloads,
 * picks the most valuable one per variant, prices it and publishes the signed bid.
 *
 * Bids are one-shot per (slot, parent block hash, parent block root) and always broadcast,
 * competing bids are not considered.
 */
export class SlotBidder {
  private readonly slots = new Map<Slot, SlotState>();

  constructor(
    private readonly modules: SlotBidderModules,
    private readonly opts: SlotBidderOpts
  ) {}

  onPayloadAttributes(event: PayloadAttributesEvent): void {
    const {clock, logger} = this.modules;
    if (!isForkPostGloas(event.version)) {
      return;
    }
    const data = event.data as gloas.SSEPayloadAttributes;
    const slot = data.proposalSlot;
    const currentSlot = clock.getCurrentSlot();
    if (slot <= currentSlot) {
      logger.debug("Ignoring payload attributes for past slot", {slot, currentSlot});
      return;
    }

    const state = this.getOrCreateSlotState(slot);
    if (state.done) {
      return;
    }

    const parentBlockHash = toRootHex(data.parentBlockHash);
    if (state.variants.has(parentBlockHash)) {
      return;
    }

    const payloadAttributes: PayloadAttributes = {
      timestamp: data.payloadAttributes.timestamp,
      prevRandao: data.payloadAttributes.prevRandao,
      suggestedFeeRecipient: toHex(this.modules.executionFeeRecipient),
      withdrawals: data.payloadAttributes.withdrawals,
      parentBeaconBlockRoot: data.payloadAttributes.parentBeaconBlockRoot,
      slotNumber: data.payloadAttributes.slotNumber,
      targetGasLimit: data.payloadAttributes.targetGasLimit,
    };

    const variant: VariantBuild = {
      parentBlockRoot: data.parentBlockRoot,
      parentBlockRootHex: toRootHex(data.parentBlockRoot),
      parentBlockHash,
      request: {
        fork: state.fork,
        forkchoiceState: {
          headBlockHash: parentBlockHash,
          safeBlockHash: event.safeBlockHash ?? ZERO_HASH_HEX,
          finalizedBlockHash: event.finalizedBlockHash ?? ZERO_HASH_HEX,
        },
        payloadAttributes,
      },
      handles: new Map(),
    };
    state.variants.set(parentBlockHash, variant);

    logger.verbose("Preparing payload build", {
      slot,
      parentBlockRoot: variant.parentBlockRootHex,
      parentBlockHash,
      msToDeadline: state.deadlineMs - Date.now(),
      targetGasLimit: data.payloadAttributes.targetGasLimit,
    });

    for (const source of this.modules.sources) {
      this.prepareOnSource(state, variant, source).catch((e) => {
        logger.error("Error preparing payload build", {slot, source: source.id}, e as Error);
      });
    }

    if (this.modules.preferences.get(slot) === null) {
      logger.debug("No proposer preferences known yet for slot", {slot});
    }
  }

  /** Drop state of past slots */
  onSlot(currentSlot: Slot): void {
    for (const [slot, state] of this.slots) {
      if (slot <= currentSlot) {
        clearTimeout(state.deadlineTimer);
        this.slots.delete(slot);
      }
    }
  }

  close(): void {
    for (const state of this.slots.values()) {
      clearTimeout(state.deadlineTimer);
    }
    this.slots.clear();
  }

  private getOrCreateSlotState(slot: Slot): SlotState {
    const existing = this.slots.get(slot);
    if (existing !== undefined) {
      return existing;
    }
    const {config, clock, logger} = this.modules;
    // Deadline is measured within the slot before the target slot
    const msToDeadline =
      clock.msToSlot(slot) - config.SLOT_DURATION_MS + config.getSlotComponentDurationMs(this.opts.deadlineBps);
    const state: SlotState = {
      slot,
      fork: config.getForkName(slot),
      variants: new Map(),
      deadlineMs: Date.now() + Math.max(msToDeadline, 0),
      deadlineTimer: setTimeout(
        () => {
          this.onDeadline(state).catch((e) => {
            logger.error("Error bidding at deadline", {slot}, e as Error);
          });
        },
        Math.max(msToDeadline, 0)
      ),
      done: false,
    };
    this.slots.set(slot, state);
    return state;
  }

  private async prepareOnSource(state: SlotState, variant: VariantBuild, source: PayloadSource): Promise<void> {
    const {logger, metrics} = this.modules;
    const timer = metrics?.builds.prepareTime.startTimer({source: source.id});
    let attempt = 0;
    while (!state.done) {
      attempt++;
      try {
        const handle = await source.prepare(variant.request);
        variant.handles.set(source.id, handle);
        timer?.();
        logger.debug("Payload build started", {
          slot: state.slot,
          source: source.id,
          parentBlockHash: variant.parentBlockHash,
          payloadId: handle.payloadId,
          attempt,
        });
        return;
      } catch (e) {
        // Parent payload not imported by the execution client yet, or transient error. Retry until the deadline.
        const msToDeadline = state.deadlineMs - Date.now();
        if (msToDeadline <= this.opts.prepareRetryMs) {
          metrics?.builds.prepareFailed.inc({source: source.id});
          logger.warn(
            "Failed to start payload build before deadline",
            {slot: state.slot, source: source.id, parentBlockHash: variant.parentBlockHash, attempt},
            e as Error
          );
          return;
        }
        if (attempt === 1) {
          logger.debug(
            "Failed to start payload build, retrying",
            {slot: state.slot, source: source.id, parentBlockHash: variant.parentBlockHash},
            e as Error
          );
        }
        await sleep(this.opts.prepareRetryMs);
      }
    }
  }

  private async onDeadline(state: SlotState): Promise<void> {
    const {logger} = this.modules;
    state.done = true;

    if (state.variants.size === 0) {
      logger.debug("No payload attributes received for slot, not bidding", {slot: state.slot});
      return;
    }

    await Promise.all(
      Array.from(state.variants.values()).map(async (variant) => {
        try {
          const best = await this.fetchBestPayload(state, variant);
          if (best === null) {
            return;
          }
          await this.submitBid(state, variant, best);
        } catch (e) {
          logger.error(
            "Error submitting bid",
            {slot: state.slot, parentBlockHash: variant.parentBlockHash},
            e as Error
          );
        }
      })
    );
  }

  private async fetchBestPayload(state: SlotState, variant: VariantBuild): Promise<BuiltPayload | null> {
    const {logger, metrics} = this.modules;
    if (variant.handles.size === 0) {
      logger.warn("No payload build started for variant, not bidding", {
        slot: state.slot,
        parentBlockHash: variant.parentBlockHash,
      });
      metrics?.bids.submitted.inc({result: "no_build"});
      return null;
    }

    const results = await Promise.allSettled(
      Array.from(variant.handles.values()).map(async (handle) => {
        const source = this.modules.sources.find((s) => s.id === handle.sourceId);
        if (source === undefined) {
          throw Error(`Unknown payload source ${handle.sourceId}`);
        }
        const timer = metrics?.builds.getPayloadTime.startTimer({source: source.id});
        const payload = await withTimeout(source.getPayload(state.fork, handle), this.opts.getPayloadTimeoutMs);
        timer?.();
        return payload;
      })
    );

    let best: BuiltPayload | null = null;
    for (const result of results) {
      if (result.status === "rejected") {
        logger.warn(
          "Failed to get payload",
          {slot: state.slot, parentBlockHash: variant.parentBlockHash},
          result.reason
        );
        continue;
      }
      const payload = result.value;
      metrics?.bids.payloadValue.set({source: payload.sourceId}, Number(payload.executionPayloadValue / GWEI_TO_WEI));
      if (best === null || payload.executionPayloadValue > best.executionPayloadValue) {
        best = payload;
      }
    }

    if (best === null) {
      metrics?.bids.submitted.inc({result: "no_payload"});
    }
    return best;
  }

  private async submitBid(state: SlotState, variant: VariantBuild, best: BuiltPayload): Promise<void> {
    const {api, clock, logger, ledger, metrics, policy, preferences, signer, store} = this.modules;
    const {slot} = state;
    const {executionPayload} = best;
    const blockHash = toRootHex(executionPayload.blockHash);
    const logCtx = {slot, blockHash, parentBlockHash: variant.parentBlockHash, source: best.sourceId};

    if (toRootHex(executionPayload.parentHash) !== variant.parentBlockHash) {
      logger.error("Execution client built on unexpected parent, not bidding", {
        ...logCtx,
        payloadParentHash: toRootHex(executionPayload.parentHash),
      });
      metrics?.bids.submitted.inc({result: "wrong_parent"});
      return;
    }

    if (ledger.hasSubmitted(slot, variant.parentBlockHash, variant.parentBlockRootHex)) {
      return;
    }

    const proposerPreferences = preferences.get(slot);
    if (proposerPreferences === null) {
      logger.warn("No proposer preferences known for slot, not bidding", logCtx);
      metrics?.bids.submitted.inc({result: "no_proposer_preferences"});
      return;
    }

    const {status, balance} = this.modules.getBuilderStatus();
    if (status === undefined || balance === undefined) {
      logger.warn("Builder status unknown, not bidding", logCtx);
      metrics?.bids.submitted.inc({result: "unknown_status"});
      return;
    }
    if (status !== "active") {
      logger.warn("Builder is not active, not bidding", {...logCtx, status});
      metrics?.bids.submitted.inc({result: "inactive"});
      return;
    }
    if (balance < this.opts.minOperatingBalanceGwei) {
      logger.warn("Builder balance below operating minimum, not bidding", {
        ...logCtx,
        balance,
        minOperatingBalanceGwei: this.opts.minOperatingBalanceGwei,
      });
      metrics?.bids.submitted.inc({result: "low_balance"});
      return;
    }

    const unsettledGwei = ledger.getUnsettledValueGwei(computeEpochAtSlot(slot));
    const coverableGwei = Math.max(balance - MIN_DEPOSIT_AMOUNT - unsettledGwei, 0);
    const payloadValueGwei = Number(best.executionPayloadValue / GWEI_TO_WEI);
    const value = policy.computeValue({slot, payloadValueGwei, coverableGwei});
    if (value === null) {
      logger.info("Bid policy declined to bid", {...logCtx, payloadValueGwei, coverableGwei, unsettledGwei});
      metrics?.bids.submitted.inc({result: "policy_declined"});
      return;
    }

    store.add({slot, parentBlockRoot: variant.parentBlockRoot, blockHash, payload: best});

    const bid: gloas.ExecutionPayloadBid = {
      parentBlockHash: executionPayload.parentHash,
      parentBlockRoot: variant.parentBlockRoot,
      blockHash: executionPayload.blockHash,
      prevRandao: executionPayload.prevRandao,
      feeRecipient: proposerPreferences.message.feeRecipient,
      gasLimit: BigInt(executionPayload.gasLimit),
      builderIndex: this.modules.builderIndex,
      slot,
      value,
      executionPayment: 0n,
      blobKzgCommitments: best.blobsBundle.commitments,
      executionRequestsRoot: sszTypesFor(state.fork as ForkPostGloas).ExecutionRequests.hashTreeRoot(
        best.executionRequests
      ),
    };
    const signedBid = signer.signExecutionPayloadBid(bid);

    ledger.recordBid({
      slot,
      parentBlockHash: variant.parentBlockHash,
      parentBlockRoot: variant.parentBlockRootHex,
      blockHash,
      valueGwei: value,
    });

    try {
      (await api.beacon.publishExecutionPayloadBid({signedExecutionPayloadBid: signedBid})).assertOk();
    } catch (e) {
      metrics?.bids.submitted.inc({result: "publish_error"});
      throw e;
    }

    metrics?.bids.submitted.inc({result: "published"});
    metrics?.bids.value.set(value);
    metrics?.bids.submitTime.observe(clock.secFromSlot(slot - 1));

    logger.info("Published execution payload bid", {
      ...logCtx,
      value,
      payloadValueGwei,
      coverableGwei,
      feeRecipient: toHex(bid.feeRecipient),
      gasLimit: executionPayload.gasLimit,
      transactions: executionPayload.transactions.length,
      blobs: bid.blobKzgCommitments.length,
      secFromSlot: clock.secFromSlot(slot - 1),
    });
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
