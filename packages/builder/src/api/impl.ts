import {ApiClient, routes} from "@lodestar/api";
import type {BuilderApiMethods} from "@lodestar/api/builder/server";
import {ApiError} from "@lodestar/api/server";
import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_PROPOSER, DOMAIN_BUILDER_REQUEST_AUTH, ForkPostGloas, isForkPostGloas} from "@lodestar/params";
import {
  IClock,
  ZERO_HASH,
  computeDomain,
  computeSigningRoot,
  createSingleSignatureSetFromComponents,
  verifySignatureSet,
} from "@lodestar/state-transition";
import {BLSPubkey, BuilderIndex, RootHex, SignedBlockContents, Slot, gloas, ssz, sszTypesFor} from "@lodestar/types";
import {Logger, byteArrayEquals, prettyGweiToEth, toPubkeyHex, toRootHex} from "@lodestar/utils";
import {BidRequestResult, Metrics} from "../metrics.js";
import {BidLedger} from "../services/bidLedger.js";
import {ProposerDutiesTracker} from "../services/proposerDutiesTracker.js";

/**
 * Bids are served to proposers for this many slots after their slot.
 * The ledger retains them for longer to track their payment.
 */
const SERVE_BID_SLOTS = 2;

/** Routes of the builder API that apply from Gloas onwards */
export type BuilderApi = Pick<
  BuilderApiMethods,
  "status" | "getExecutionPayloadBid" | "submitSignedBeaconBlock" | "submitBuilderPreferences"
>;

export type BuilderApiOptions = {
  /** Auth data proposers must sign their requests with */
  authData: Uint8Array;
};

export type BuilderApiModules = {
  config: BeaconConfig;
  logger: Logger;
  clock: IClock;
  api: ApiClient;
  ledger: BidLedger;
  proposerDutiesTracker: ProposerDutiesTracker;
  builderIndex: BuilderIndex;
  metrics: Metrics | null;
};

/** Serves the published bids to proposers that request them directly and accepts their signed blocks */
export function getBuilderApi(modules: BuilderApiModules, opts: BuilderApiOptions): BuilderApi {
  const {api, builderIndex, clock, config, ledger, logger, metrics, proposerDutiesTracker} = modules;

  /** The bid published for the slot and parent, null if there is none or it is no longer served */
  function getServedBid(
    slot: Slot,
    parentBlockHash: RootHex,
    parentBlockRoot: RootHex
  ): gloas.SignedExecutionPayloadBid | null {
    if (slot + SERVE_BID_SLOTS < clock.getCurrentSlot()) {
      return null;
    }
    return ledger.getSignedBid(slot, parentBlockHash, parentBlockRoot);
  }

  async function assertValidRequestAuth(
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

  return {
    async status() {
      // The builder is ready to serve requests once it is started
    },

    async getExecutionPayloadBid({slot, parentHash, parentRoot, proposerPubkey, requestAuth}) {
      if (requestAuth.message.slot !== slot) {
        throw new ApiError(
          400,
          "Invalid SignedBuilderRequestAuth: auth.message.slot does not match the proposal slot in the request path"
        );
      }
      await assertValidRequestAuth(requestAuth, proposerPubkey);

      const parentBlockHash = toRootHex(parentHash);
      const parentBlockRoot = toRootHex(parentRoot);
      const logCtx = {slot, parentBlockHash, parentBlockRoot, proposer: toPubkeyHex(proposerPubkey)};
      const version = config.getForkName(slot);

      const signedBid = getServedBid(slot, parentBlockHash, parentBlockRoot);
      if (signedBid === null) {
        metrics?.api.bidRequests.inc({result: BidRequestResult.noBid});
        logger.debug("No execution payload bid to serve", logCtx);
        return {data: undefined, meta: {version}, status: 204};
      }

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
      const fork = config.getForkName(slot);
      if (!isForkPostGloas(fork)) {
        throw new ApiError(400, `Invalid signed beacon block: slot ${slot} is before Gloas`);
      }
      const bid = block.message.body.signedExecutionPayloadBid.message;
      const blockRoot = toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message));
      const logCtx = {slot, blockRoot, blockHash: toRootHex(bid.blockHash)};

      // The block must carry the bid as we signed it, a bid that only keeps our block hash and signature
      // passes gossip validation of the beacon node but the block fails to be imported
      const signedBid = getServedBid(slot, toRootHex(bid.parentBlockHash), toRootHex(bid.parentBlockRoot));
      const signedBidType = sszTypesFor(fork, "SignedExecutionPayloadBid");
      if (
        bid.builderIndex !== builderIndex ||
        signedBid === null ||
        !byteArrayEquals(
          signedBidType.hashTreeRoot(signedBid),
          signedBidType.hashTreeRoot(block.message.body.signedExecutionPayloadBid)
        )
      ) {
        throw new ApiError(400, "Invalid signed beacon block: does not commit to a bid of this builder");
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
      await assertValidRequestAuth(auth, proposerPubkey);

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

function isValidSignature(pubkey: BLSPubkey, signingRoot: Uint8Array, signature: Uint8Array): boolean {
  try {
    return verifySignatureSet(createSingleSignatureSetFromComponents(pubkey, signingRoot, signature));
  } catch {
    // Malformed public keys and signatures are invalid
    return false;
  }
}
