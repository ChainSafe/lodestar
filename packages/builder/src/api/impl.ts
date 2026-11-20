import {ApiClient, routes} from "@lodestar/api";
import type {BuilderApiMethods} from "@lodestar/api/builder/server";
import {ApiError} from "@lodestar/api/server";
import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_PROPOSER, DOMAIN_BUILDER_REQUEST_AUTH, ForkPostGloas} from "@lodestar/params";
import {
  IClock,
  ZERO_HASH,
  computeDomain,
  computeSigningRoot,
  createSingleSignatureSetFromComponents,
  verifySignatureSet,
} from "@lodestar/state-transition";
import {BLSPubkey, BuilderIndex, SignedBlockContents, gloas, ssz} from "@lodestar/types";
import {Logger, byteArrayEquals, isErrorAborted, prettyGweiToEth, sleep, toPubkeyHex, toRootHex} from "@lodestar/utils";
import {BidRequestResult, Metrics} from "../metrics.js";
import {BidStore} from "../services/bidStore.js";
import {ProposerDutiesTracker} from "../services/proposerDutiesTracker.js";

const BID_RESPONSE_MARGIN_MS = 50;
const MAX_WAITING_BID_REQUESTS = 64;

/** Routes of the builder API that apply from Gloas onwards */
export type BuilderApi = Pick<
  BuilderApiMethods,
  "status" | "getExecutionPayloadBid" | "submitSignedBeaconBlock" | "submitBuilderPreferences"
>;

export type BuilderApiOptions = {
  /** Auth data proposers must sign their requests with */
  authData: Uint8Array;
  /** HTTP only: optional operator estimate limiting the mirrored return allowance. */
  httpReturnReserveCapMs?: number;
  /** HTTP only: scheduling/serialization headroom; tune separately from the return allowance. */
  httpResponseMarginMs?: number;
};

export function validateHttpBidResponseTiming(
  opts: Pick<BuilderApiOptions, "httpReturnReserveCapMs" | "httpResponseMarginMs">
): void {
  const {httpReturnReserveCapMs: cap, httpResponseMarginMs: margin} = opts;
  if (cap !== undefined && (!Number.isSafeInteger(cap) || cap < 0 || cap > 10_000)) {
    throw Error("--builderApi.httpReturnReserveCapMs must be an integer between 0 and 10000");
  }
  if (margin !== undefined && (!Number.isSafeInteger(margin) || margin < 20 || margin > 1_000)) {
    throw Error("--builderApi.httpResponseMarginMs must be an integer between 20 and 1000");
  }
}

export type BuilderApiModules = {
  config: BeaconConfig;
  logger: Logger;
  clock: IClock;
  api: ApiClient;
  bidStore: BidStore;
  proposerDutiesTracker: ProposerDutiesTracker;
  builderIndex: BuilderIndex;
  metrics: Metrics | null;
  signal?: AbortSignal;
};

/** Serves retained bids to proposers that request them directly and accepts their signed blocks */
export function getBuilderApi(modules: BuilderApiModules, opts: BuilderApiOptions): BuilderApi {
  const {api, bidStore, builderIndex, clock, config, logger, metrics, proposerDutiesTracker} = modules;
  validateHttpBidResponseTiming(opts);
  const responseMarginMs = opts.httpResponseMarginMs ?? BID_RESPONSE_MARGIN_MS;
  const returnReserveCapMs = opts.httpReturnReserveCapMs ?? Infinity;
  logger.info("HTTP bid response timing", {
    responseMarginMs,
    returnReserveCapMs: opts.httpReturnReserveCapMs ?? "request age",
  });
  let waitingBidRequests = 0;

  return {
    async status() {
      // The builder is ready to serve requests once it is started
    },

    async getExecutionPayloadBid(
      {slot, parentHash, parentRoot, proposerPubkey, requestAuth, dateMilliseconds, timeoutMs},
      context
    ) {
      if (modules.signal?.aborted) throw new ApiError(503, "Builder is stopping");
      const started = performance.now();
      const transitMs = Date.now() - dateMilliseconds;
      // Request age includes connection setup, queues and clock offset, not just network transit.
      // Keep the proposer's deadline anchor. An optional return cap is an operator assumption,
      // not a measured return path. Future timestamps disable waiting because of clock skew.
      // Use the slot end to bound long waits: a revision can finish retention after construction stops.
      const waitBudget = bidResponseBudgets(clock, config, slot, transitMs, timeoutMs, {
        returnReserveCapMs,
        responseMarginMs,
      }).waitMs;
      if (requestAuth.message.slot !== slot) {
        throw new ApiError(
          400,
          "Invalid SignedBuilderRequestAuth: auth.message.slot does not match the proposal slot in the request path"
        );
      }
      await assertValidRequestAuth(modules, opts, requestAuth, proposerPubkey);

      if (modules.signal?.aborted) throw new ApiError(503, "Builder is stopping");
      const waitMs = Math.max(0, waitBudget - (performance.now() - started));
      const waitStarted = performance.now();
      const waitCapacityExceeded = waitMs > 0 && waitingBidRequests >= MAX_WAITING_BID_REQUESTS;
      if (waitMs > 0 && !waitCapacityExceeded) {
        waitingBidRequests++;
        try {
          await sleep(waitMs, modules.signal);
        } catch (error) {
          if (isErrorAborted(error)) throw new ApiError(503, "Builder is stopping");
          throw error;
        } finally {
          waitingBidRequests--;
        }
      }
      if (modules.signal?.aborted) throw new ApiError(503, "Builder is stopping");

      const parentBlockHash = toRootHex(parentHash);
      const parentBlockRoot = toRootHex(parentRoot);
      const logCtx = {
        slot,
        parentBlockHash,
        parentBlockRoot,
        proposer: toPubkeyHex(proposerPubkey),
        requestTransitMs: transitMs,
        requestAgeMs: transitMs,
        returnReserveMs: Math.max(0, Math.min(transitMs, returnReserveCapMs)),
        responseMarginMs,
        waitBudgetMs: Math.round(waitBudget),
        bidWaitMs: Math.round(performance.now() - waitStarted),
        responseReadyOverrunMs: Math.max(0, Math.round(performance.now() - started - waitBudget)),
        waitCapacityExceeded,
      };
      const version = config.getForkName(slot);

      const signedBid = bidStore.get(slot, parentBlockHash, parentBlockRoot);
      if (signedBid === null) {
        metrics?.api.bidRequests.inc({result: BidRequestResult.noBid});
        logger.debug("No execution payload bid to serve", logCtx);
        return {data: undefined, meta: {version}, status: 204};
      }

      context?.setResponseGuard?.(() => bidStore.canOffer(signedBid));

      metrics?.api.bidRequests.inc({result: BidRequestResult.served});
      logger.info("Served execution payload bid", {
        ...logCtx,
        blockHash: toRootHex(signedBid.message.blockHash),
        value: prettyGweiToEth(signedBid.message.value),
        secFromSlot: clock.secFromSlot(slot),
      });
      return {data: signedBid, meta: {version}};
    },

    async submitSignedBeaconBlock({signedBlock}) {
      const block = signedBlock.data;
      const {slot, proposerIndex} = block.message;
      const bid = block.message.body.signedExecutionPayloadBid.message;
      const blockRoot = toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message));
      const logCtx = {slot, blockRoot, blockHash: toRootHex(bid.blockHash)};

      if (bid.builderIndex !== builderIndex || !bidStore.has(block.message.body.signedExecutionPayloadBid)) {
        throw new ApiError(400, "Invalid signed beacon block: does not commit to a retained bid of this builder");
      }

      const proposer = await proposerDutiesTracker.getProposer(slot);
      if (proposer === null || proposer.validatorIndex !== proposerIndex) {
        throw new ApiError(400, `Invalid signed beacon block: not proposed by the proposer of slot ${slot}`);
      }
      const domain = config.getDomain(slot, DOMAIN_BEACON_PROPOSER);
      const signingRoot = computeSigningRoot(config.getForkTypes(slot).BeaconBlock, block.message, domain);
      if (!isValidSignature(proposer.pubkey, signingRoot, block.signature)) {
        throw new ApiError(400, "Invalid signed beacon block: signature verification failed");
      }

      metrics?.api.blockSubmissions.inc();
      logger.info("Received signed beacon block from proposer", {...logCtx, secFromSlot: clock.secFromSlot(slot)});

      // The payload is revealed once the beacon node imported the block and emits its block event
      (
        await api.beacon.publishBlockV2({
          signedBlockContents: {signedBlock: block} as SignedBlockContents<ForkPostGloas>,
          broadcastValidation: routes.beacon.BroadcastValidation.gossip,
        })
      ).assertOk();

      return {status: 202};
    },

    async submitBuilderPreferences({proposerPubkey, request}) {
      const {auth, preferences} = request;
      const {slot} = auth.message;
      if (slot < clock.getCurrentSlot()) {
        throw new ApiError(400, "Invalid SignedBuilderRequestAuth: auth.message.slot has already passed");
      }
      await assertValidRequestAuth(modules, opts, auth, proposerPubkey);

      // Bids only pay via their value, there is no execution payment the preferences could cap
      logger.debug("Received builder preferences", {
        slot,
        proposer: toPubkeyHex(proposerPubkey),
        maxExecutionPayment: prettyGweiToEth(preferences.maxExecutionPayment),
      });

      return {status: 202};
    },
  };
}

export function bidWaitBudget(
  clock: IClock,
  config: BeaconConfig,
  slot: number,
  transitMs: number,
  timeoutMs: number
): number {
  return bidResponseBudgets(clock, config, slot, transitMs, timeoutMs).waitMs;
}

export function bidResponseBudgets(
  clock: IClock,
  config: BeaconConfig,
  slot: number,
  transitMs: number,
  timeoutMs: number,
  timing: {returnReserveCapMs: number; responseMarginMs: number} = {
    returnReserveCapMs: Infinity,
    responseMarginMs: BID_RESPONSE_MARGIN_MS,
  }
): {waitMs: number; hardStopMs: number} {
  const currentSlot = clock.getCurrentSlot();
  if (!(transitMs >= 0 && slot >= currentSlot && slot <= currentSlot + 1)) return {waitMs: 0, hardStopMs: 0};
  const slotRemaining = clock.msToSlot(slot) + config.getSlotDurationMs(config.getForkName(slot));
  const requestRemaining = timeoutMs - transitMs - timing.responseMarginMs;
  return {
    waitMs: Math.max(0, Math.min(requestRemaining - Math.min(transitMs, timing.returnReserveCapMs), slotRemaining)),
    hardStopMs: Math.max(0, Math.min(requestRemaining, slotRemaining)),
  };
}

export async function assertValidRequestAuth(
  {config, proposerDutiesTracker}: BuilderApiModules,
  opts: BuilderApiOptions,
  auth: gloas.SignedBuilderRequestAuth,
  proposerPubkey: BLSPubkey
): Promise<void> {
  if (!byteArrayEquals(auth.message.data, opts.authData)) {
    throw new ApiError(
      400,
      "Invalid SignedBuilderRequestAuth: auth.message.data does not match the value agreed with this builder"
    );
  }
  const proposer = await proposerDutiesTracker.getProposer(auth.message.slot);
  if (proposer === null || !byteArrayEquals(proposer.pubkey, proposerPubkey)) {
    throw new ApiError(400, `Invalid request: proposer_pubkey is not the proposer of slot ${auth.message.slot}`);
  }
  const domain = computeDomain(DOMAIN_BUILDER_REQUEST_AUTH, config.GENESIS_FORK_VERSION, ZERO_HASH);
  const signingRoot = computeSigningRoot(ssz.gloas.BuilderRequestAuth, auth.message, domain);
  if (!isValidSignature(proposerPubkey, signingRoot, auth.signature)) {
    throw new ApiError(401, "Invalid SignedBuilderRequestAuth: signature verification failed");
  }
}

function isValidSignature(pubkey: BLSPubkey, signingRoot: Uint8Array, signature: Uint8Array): boolean {
  try {
    return verifySignatureSet(createSingleSignatureSetFromComponents(pubkey, signingRoot, signature));
  } catch {
    // Malformed public keys and signatures are invalid
    return false;
  }
}
