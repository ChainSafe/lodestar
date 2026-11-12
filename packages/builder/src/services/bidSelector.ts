import type {ChainForkConfig} from "@lodestar/config";
import type {ForkPostGloas} from "@lodestar/params";
import type {BuilderIndex, RootHex, SignedBeaconBlock, Slot} from "@lodestar/types";
import {sszTypesFor} from "@lodestar/types";
import {LodestarError, toRootHex} from "@lodestar/utils";
import type {BidIdentity, BidLedger, BidLedgerRecord} from "./bidLedger.js";

export type ObservedPostGloasBlock = {
  blockRoot: RootHex;
  slot: Slot;
  version: ForkPostGloas;
  block: SignedBeaconBlock<ForkPostGloas>;
};

export type BidSelectorModules = {
  config: ChainForkConfig;
  ledger: BidLedger;
  builderIndex: BuilderIndex;
};

export enum BidSelectionIgnoreReason {
  FOREIGN_BUILDER = "foreign_builder",
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
  UNKNOWN_BID = "BID_SELECTOR_ERROR_UNKNOWN_BID",
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
    }
  | {
      code: BidSelectorErrorCode.UNKNOWN_BID;
      slot: Slot;
      parentBlockHash: RootHex;
      parentBlockRoot: RootHex;
      blockHash: RootHex;
      signedBidRoot: RootHex;
    };

export class BidSelectorError extends LodestarError<BidSelectorErrorType> {}

/** Matches an imported post-Gloas block to an exact local bid and records the win. */
export class BidSelector {
  constructor(private readonly modules: BidSelectorModules) {}

  match(observed: ObservedPostGloasBlock): BidSelectionResult {
    const {block, blockRoot, slot, version} = observed;
    const {builderIndex, config, ledger} = this.modules;
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

    const identity: BidIdentity = {
      slot,
      parentBlockHash: toRootHex(bid.parentBlockHash),
      parentBlockRoot: toRootHex(bid.parentBlockRoot),
      blockHash: toRootHex(bid.blockHash),
    };
    const signedBidRoot = toRootHex(
      sszTypesFor(version, "SignedExecutionPayloadBid").hashTreeRoot(block.message.body.signedExecutionPayloadBid)
    );
    const localBid = ledger.recordWin({...identity, signedBidRoot}, blockRoot);
    if (localBid === null) {
      throw new BidSelectorError(
        {code: BidSelectorErrorCode.UNKNOWN_BID, ...identity, signedBidRoot},
        `Selected bid is not in the local ledger slot=${slot} blockHash=${identity.blockHash} signedBidRoot=${signedBidRoot}`
      );
    }

    return {status: "selected", blockRoot, bid: localBid};
  }
}
