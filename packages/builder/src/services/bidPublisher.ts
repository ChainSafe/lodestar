import type {ApiClient} from "@lodestar/api";
import type {ChainForkConfig} from "@lodestar/config";
import {isForkPostGloas} from "@lodestar/params";
import type {BuilderIndex, RootHex, Slot, gloas, heze} from "@lodestar/types";
import {sszTypesFor} from "@lodestar/types";
import {LodestarError, toRootHex} from "@lodestar/utils";
import type {BidIdentity, BidLedger} from "./bidLedger.js";
import {BidLedgerError, BidLedgerErrorCode} from "./bidLedger.js";
import type {BuilderSigner} from "./builderSigner.js";
import {CommitmentJournalError} from "./commitmentJournalError.js";
import {BID_HISTORY_SLOTS, MAX_BID_REVISIONS_PER_SLOT} from "./commitmentLimits.js";
import {type OfferEligibility, isOfferEligible} from "./offerEligibility.js";
import type {StoredPayload} from "./payloadStore.js";

export type BidPublisherModules = {
  api: ApiClient;
  config: ChainForkConfig;
  signer: BuilderSigner;
  ledger: BidLedger;
  builderIndex: BuilderIndex;
  hasPayload: (identity: BidIdentity) => boolean;
  requireOfferContext?: boolean;
  canSign?: (identity: BidIdentity, offered?: StoredPayload) => boolean;
  /** Must finish durable retention before the signature can be exposed. */
  retainCommitment?: (bid: gloas.SignedExecutionPayloadBid, offered?: StoredPayload) => void | Promise<void>;
};

export enum BidPublisherErrorCode {
  BUILDER_INDEX_MISMATCH = "BID_PUBLISHER_ERROR_BUILDER_INDEX_MISMATCH",
  PAYLOAD_NOT_RETAINED = "BID_PUBLISHER_ERROR_PAYLOAD_NOT_RETAINED",
  PRE_GLOAS_BID = "BID_PUBLISHER_ERROR_PRE_GLOAS_BID",
  BID_NOT_PREPARED = "BID_PUBLISHER_ERROR_BID_NOT_PREPARED",
}

export type BidPublisherErrorType =
  | {
      code: BidPublisherErrorCode.PRE_GLOAS_BID | BidPublisherErrorCode.BID_NOT_PREPARED;
      slot: Slot;
    }
  | {
      code: BidPublisherErrorCode.BUILDER_INDEX_MISMATCH;
      builderIndex: BuilderIndex;
      bidBuilderIndex: BuilderIndex;
    }
  | {
      code: BidPublisherErrorCode.PAYLOAD_NOT_RETAINED;
      slot: Slot;
      parentBlockHash: RootHex;
      parentBlockRoot: RootHex;
      blockHash: RootHex;
    };

export class BidPublisherError extends LodestarError<BidPublisherErrorType> {}

/** Signs and submits a bid only if its payload is retained locally. */
export class BidPublisher {
  private readonly pendingRevisions = new Map<Slot, number>();
  private readonly preparedAdmissions = new Map<Slot, number>();
  private readonly pendingGossip = new Set<string>();
  constructor(private readonly modules: BidPublisherModules) {}

  /** Includes uncertain writes whose revision admission remains reserved. */
  hasPendingRevisions(slot: Slot): boolean {
    return (this.pendingRevisions.get(slot) ?? 0) > 0;
  }

  publish(
    bid: heze.ExecutionPayloadBid,
    signal: AbortSignal,
    eligibility?: OfferEligibility,
    offered?: StoredPayload
  ): Promise<heze.SignedExecutionPayloadBid>;
  publish(
    bid: gloas.ExecutionPayloadBid,
    signal: AbortSignal,
    eligibility?: OfferEligibility,
    offered?: StoredPayload
  ): Promise<gloas.SignedExecutionPayloadBid>;
  async publish(
    bid: gloas.ExecutionPayloadBid,
    signal: AbortSignal,
    eligibility?: OfferEligibility,
    offered?: StoredPayload
  ): Promise<gloas.SignedExecutionPayloadBid> {
    signal.throwIfAborted();
    this.modules.ledger.assertCanRecordBid({
      slot: bid.slot,
      parentBlockHash: toRootHex(bid.parentBlockHash),
      parentBlockRoot: toRootHex(bid.parentBlockRoot),
    });
    const key = `${bid.slot}:${toRootHex(bid.parentBlockHash)}:${toRootHex(bid.parentBlockRoot)}`;
    if (this.pendingGossip.has(key))
      throw new BidLedgerError({
        code: BidLedgerErrorCode.DUPLICATE_BID,
        slot: bid.slot,
        parentBlockHash: toRootHex(bid.parentBlockHash),
        parentBlockRoot: toRootHex(bid.parentBlockRoot),
      });
    this.pendingGossip.add(key);
    try {
      if (!isOfferEligible(eligibility)) throw Error("BID_OFFER_INELIGIBLE");
      const signed = await this.prepare(bid, undefined, offered);
      if (!isOfferEligible(eligibility)) throw Error("BID_OFFER_INELIGIBLE");
      await this.gossip(signed, signal, eligibility);
      return signed;
    } finally {
      this.pendingGossip.delete(key);
    }
  }

  /** Sign a retained payload and journal the commitment before the API can expose it. */
  async prepare(
    bid: gloas.ExecutionPayloadBid,
    revisionLimit = MAX_BID_REVISIONS_PER_SLOT,
    offered?: StoredPayload
  ): Promise<gloas.SignedExecutionPayloadBid> {
    if (this.modules.requireOfferContext && !offered) throw Error("COMMITMENT_OFFER_MISSING");
    if (!Number.isSafeInteger(revisionLimit) || revisionLimit < 1 || revisionLimit > MAX_BID_REVISIONS_PER_SLOT)
      throw new RangeError("Invalid bid revision limit");
    const {config, builderIndex, hasPayload, ledger, signer} = this.modules;
    const fork = config.getForkName(bid.slot);
    if (!isForkPostGloas(fork)) {
      throw new BidPublisherError({code: BidPublisherErrorCode.PRE_GLOAS_BID, slot: bid.slot});
    }
    if (bid.builderIndex !== builderIndex) {
      throw new BidPublisherError(
        {
          code: BidPublisherErrorCode.BUILDER_INDEX_MISMATCH,
          builderIndex,
          bidBuilderIndex: bid.builderIndex,
        },
        `Bid builder index does not match local builder index builderIndex=${builderIndex} bidBuilderIndex=${bid.builderIndex}`
      );
    }

    const identity: BidIdentity = {
      slot: bid.slot,
      parentBlockHash: toRootHex(bid.parentBlockHash),
      parentBlockRoot: toRootHex(bid.parentBlockRoot),
      blockHash: toRootHex(bid.blockHash),
    };
    if (!hasPayload(identity)) {
      throw new BidPublisherError(
        {code: BidPublisherErrorCode.PAYLOAD_NOT_RETAINED, ...identity},
        `Bid payload is not retained slot=${identity.slot} parentBlockHash=${identity.parentBlockHash} parentBlockRoot=${identity.parentBlockRoot} blockHash=${identity.blockHash}`
      );
    }

    if (this.modules.canSign?.(identity, offered) === false) throw Error("ORDER_OFFER_TOO_EARLY");
    ledger.assertCanRecordRevision(identity, revisionLimit);
    for (const slot of this.pendingRevisions.keys()) {
      if (slot + BID_HISTORY_SLOTS < bid.slot) this.pendingRevisions.delete(slot);
    }
    for (const slot of this.preparedAdmissions.keys()) {
      if (slot + BID_HISTORY_SLOTS < bid.slot) this.preparedAdmissions.delete(slot);
    }
    const admitted = Math.max(this.preparedAdmissions.get(bid.slot) ?? 0, ledger.getRevisionCount(bid.slot));
    this.preparedAdmissions.set(bid.slot, admitted);
    const pending = this.pendingRevisions.get(bid.slot) ?? 0;
    if (admitted + pending >= revisionLimit)
      throw new BidLedgerError({code: BidLedgerErrorCode.REVISION_LIMIT, ...identity});
    this.pendingRevisions.set(bid.slot, pending + 1);
    let persistenceAttempted = false;
    let recorded = false;
    try {
      if (this.modules.canSign?.(identity, offered) === false) throw Error("ORDER_OFFER_TOO_EARLY");
      const signedExecutionPayloadBid = signer.signExecutionPayloadBid(bid);
      const signedBidRoot = toRootHex(
        sszTypesFor(fork, "SignedExecutionPayloadBid").hashTreeRoot(signedExecutionPayloadBid)
      );
      if (this.modules.retainCommitment) {
        if (this.modules.canSign?.(identity, offered) === false) throw Error("ORDER_OFFER_TOO_EARLY");
        persistenceAttempted = true;
        await this.modules.retainCommitment(signedExecutionPayloadBid, offered);
      }
      if (!hasPayload(identity))
        throw new BidPublisherError({code: BidPublisherErrorCode.PAYLOAD_NOT_RETAINED, ...identity});
      // A revision becomes eligible only after the worker confirms durability.
      ledger.recordRevision({...identity, valueGwei: bid.value, signedBidRoot});
      recorded = true;
      this.preparedAdmissions.set(bid.slot, (this.preparedAdmissions.get(bid.slot) ?? 0) + 1);
      return signedExecutionPayloadBid;
    } catch (error) {
      if (error instanceof CommitmentJournalError && !error.uncertain) persistenceAttempted = false;
      throw error;
    } finally {
      // A failed acknowledgement can still leave a durable signature on disk.
      // Keep that admission consumed so restart cannot recover over 256 bids.
      if (!persistenceAttempted || recorded) {
        const remaining = (this.pendingRevisions.get(bid.slot) ?? 1) - 1;
        if (remaining) this.pendingRevisions.set(bid.slot, remaining);
        else this.pendingRevisions.delete(bid.slot);
      }
    }
  }

  async gossip(
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid,
    signal: AbortSignal,
    eligibility?: OfferEligibility,
    beforeRequest?: () => void
  ): Promise<void> {
    signal.throwIfAborted();
    const assertEligible = (): void => {
      signal.throwIfAborted();
      if (!isOfferEligible(eligibility)) throw Error("BID_OFFER_INELIGIBLE");
      if (
        this.modules.canSign?.({
          slot: signedExecutionPayloadBid.message.slot,
          parentBlockHash: toRootHex(signedExecutionPayloadBid.message.parentBlockHash),
          parentBlockRoot: toRootHex(signedExecutionPayloadBid.message.parentBlockRoot),
          blockHash: toRootHex(signedExecutionPayloadBid.message.blockHash),
        }) === false
      )
        throw Error("ORDER_OFFER_TOO_EARLY");
      beforeRequest?.();
    };
    assertEligible();
    const {api, ledger, config, hasPayload, builderIndex} = this.modules;
    const bid = signedExecutionPayloadBid.message;
    const fork = config.getForkName(bid.slot);
    if (!isForkPostGloas(fork))
      throw new BidPublisherError({code: BidPublisherErrorCode.PRE_GLOAS_BID, slot: bid.slot});
    const identity = {
      slot: bid.slot,
      parentBlockHash: toRootHex(bid.parentBlockHash),
      parentBlockRoot: toRootHex(bid.parentBlockRoot),
      blockHash: toRootHex(bid.blockHash),
    };
    const signedBidRoot = toRootHex(
      sszTypesFor(fork, "SignedExecutionPayloadBid").hashTreeRoot(signedExecutionPayloadBid)
    );
    if (
      bid.builderIndex !== builderIndex ||
      !ledger.getBidsForSlot(bid.slot).some((record) => record.signedBidRoot === signedBidRoot)
    ) {
      throw new BidPublisherError({code: BidPublisherErrorCode.BID_NOT_PREPARED, slot: bid.slot});
    }
    if (!hasPayload(identity))
      throw new BidPublisherError({code: BidPublisherErrorCode.PAYLOAD_NOT_RETAINED, ...identity});
    ledger.recordBid({
      ...identity,
      valueGwei: bid.value,
      signedBidRoot,
    });

    const response = await api.beacon.publishExecutionPayloadBid(
      {signedExecutionPayloadBid},
      eligibility || beforeRequest ? {signal, beforeRequest: assertEligible} : {signal}
    );
    response.assertOk();
  }
}
