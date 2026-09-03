import type {ChainForkConfig} from "@lodestar/config";
import type {ForkPostGloas} from "@lodestar/params";
import type {BuilderIndex, RootHex, SignedBeaconBlock, Slot} from "@lodestar/types";
import {LodestarError, toRootHex} from "@lodestar/utils";
import type {BidLedger, BidLedgerRecord} from "./bidLedger.js";

export type ObservedPostGloasBlock = {
  blockRoot: RootHex;
  slot: Slot;
  version: ForkPostGloas;
  block: SignedBeaconBlock<ForkPostGloas>;
};

export type RetainedPayloadIdentity = {
  slot: Slot;
  parentBlockHash: RootHex;
  parentBlockRoot: RootHex;
  blockHash: RootHex;
};

export type BidSelectorModules = {
  config: ChainForkConfig;
  ledger: BidLedger;
  builderIndex: BuilderIndex;
  getRetainedPayloadIdentity: (blockHash: RootHex) => RetainedPayloadIdentity | null;
};

export enum BidSelectionIgnoreReason {
  FOREIGN_BUILDER = "foreign_builder",
  UNKNOWN_BID = "unknown_bid",
  PAYLOAD_NOT_RETAINED = "payload_not_retained",
  PAYLOAD_IDENTITY_MISMATCH = "payload_identity_mismatch",
}

export type BidSelectionResult =
  | {
      status: "selected";
      blockRoot: RootHex;
      bid: BidLedgerRecord;
    }
  | {
      status: "ignored";
      reason: BidSelectionIgnoreReason;
    };

export enum BidSelectorErrorCode {
  BLOCK_ROOT_MISMATCH = "BID_SELECTOR_ERROR_BLOCK_ROOT_MISMATCH",
  BLOCK_SLOT_MISMATCH = "BID_SELECTOR_ERROR_BLOCK_SLOT_MISMATCH",
  BLOCK_FORK_MISMATCH = "BID_SELECTOR_ERROR_BLOCK_FORK_MISMATCH",
  BID_SLOT_MISMATCH = "BID_SELECTOR_ERROR_BID_SLOT_MISMATCH",
}

export type BidSelectorErrorType =
  | {
      code: BidSelectorErrorCode.BLOCK_ROOT_MISMATCH;
      blockRoot: RootHex;
      computedBlockRoot: RootHex;
    }
  | {
      code: BidSelectorErrorCode.BLOCK_SLOT_MISMATCH;
      slot: Slot;
      blockSlot: Slot;
    }
  | {
      code: BidSelectorErrorCode.BLOCK_FORK_MISMATCH;
      version: ForkPostGloas;
      blockFork: string;
    }
  | {
      code: BidSelectorErrorCode.BID_SLOT_MISMATCH;
      slot: Slot;
      bidSlot: Slot;
    };

export class BidSelectorError extends LodestarError<BidSelectorErrorType> {}

/** Matches an imported post-Gloas block to exact local bid and retained-payload identities. */
export class BidSelector {
  constructor(private readonly modules: BidSelectorModules) {}

  match(observed: ObservedPostGloasBlock): BidSelectionResult {
    const {block, blockRoot, slot, version} = observed;
    const {builderIndex, config, getRetainedPayloadIdentity, ledger} = this.modules;
    const blockSlot = block.message.slot;

    if (blockSlot !== slot) {
      throw new BidSelectorError(
        {code: BidSelectorErrorCode.BLOCK_SLOT_MISMATCH, slot, blockSlot},
        `Observed block slot does not match fetched block slot=${slot} blockSlot=${blockSlot}`
      );
    }

    const blockFork = config.getForkName(slot);
    if (blockFork !== version) {
      throw new BidSelectorError(
        {code: BidSelectorErrorCode.BLOCK_FORK_MISMATCH, version, blockFork},
        `Observed block fork does not match configured fork version=${version} blockFork=${blockFork}`
      );
    }

    const computedBlockRoot = toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message));
    if (computedBlockRoot !== blockRoot) {
      throw new BidSelectorError(
        {code: BidSelectorErrorCode.BLOCK_ROOT_MISMATCH, blockRoot, computedBlockRoot},
        `Observed block root does not match fetched block blockRoot=${blockRoot} computedBlockRoot=${computedBlockRoot}`
      );
    }

    const bid = block.message.body.signedExecutionPayloadBid.message;
    if (bid.slot !== slot) {
      throw new BidSelectorError(
        {code: BidSelectorErrorCode.BID_SLOT_MISMATCH, slot, bidSlot: bid.slot},
        `Selected bid slot does not match block slot=${slot} bidSlot=${bid.slot}`
      );
    }
    if (bid.builderIndex !== builderIndex) {
      return {status: "ignored", reason: BidSelectionIgnoreReason.FOREIGN_BUILDER};
    }

    const identity: RetainedPayloadIdentity = {
      slot,
      parentBlockHash: toRootHex(bid.parentBlockHash),
      parentBlockRoot: toRootHex(bid.parentBlockRoot),
      blockHash: toRootHex(bid.blockHash),
    };
    const retained = getRetainedPayloadIdentity(identity.blockHash);
    if (retained === null) {
      return {status: "ignored", reason: BidSelectionIgnoreReason.PAYLOAD_NOT_RETAINED};
    }
    if (!sameIdentity(retained, identity)) {
      return {status: "ignored", reason: BidSelectionIgnoreReason.PAYLOAD_IDENTITY_MISMATCH};
    }

    const localBid = ledger.recordWin(identity, blockRoot);
    if (localBid === null) {
      return {status: "ignored", reason: BidSelectionIgnoreReason.UNKNOWN_BID};
    }

    return {status: "selected", blockRoot, bid: localBid};
  }
}

function sameIdentity(a: RetainedPayloadIdentity, b: RetainedPayloadIdentity): boolean {
  return (
    a.slot === b.slot &&
    a.parentBlockHash === b.parentBlockHash &&
    a.parentBlockRoot === b.parentBlockRoot &&
    a.blockHash === b.blockHash
  );
}
