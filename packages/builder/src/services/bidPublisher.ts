import type {ApiClient} from "@lodestar/api";
import type {BuilderIndex, RootHex, gloas} from "@lodestar/types";
import {LodestarError, toRootHex} from "@lodestar/utils";
import type {BidIdentity, BidLedger} from "./bidLedger.js";
import type {BuilderSigner} from "./builderSigner.js";

export type BidPublisherModules = {
  api: ApiClient;
  signer: BuilderSigner;
  ledger: BidLedger;
  builderIndex: BuilderIndex;
  hasPayload: (identity: BidIdentity) => boolean;
};

export enum BidPublisherErrorCode {
  BUILDER_INDEX_MISMATCH = "BID_PUBLISHER_ERROR_BUILDER_INDEX_MISMATCH",
  PAYLOAD_NOT_RETAINED = "BID_PUBLISHER_ERROR_PAYLOAD_NOT_RETAINED",
}

export type BidPublisherErrorType =
  | {
      code: BidPublisherErrorCode.BUILDER_INDEX_MISMATCH;
      builderIndex: BuilderIndex;
      bidBuilderIndex: BuilderIndex;
    }
  | {
      code: BidPublisherErrorCode.PAYLOAD_NOT_RETAINED;
      slot: BidIdentity["slot"];
      parentBlockHash: RootHex;
      parentBlockRoot: RootHex;
      blockHash: RootHex;
    };

export class BidPublisherError extends LodestarError<BidPublisherErrorType> {}

/** Signs and submits a complete bid only after its reveal material is retained locally. */
export class BidPublisher {
  constructor(private readonly modules: BidPublisherModules) {}

  async publish(bid: gloas.ExecutionPayloadBid, signal: AbortSignal): Promise<gloas.SignedExecutionPayloadBid> {
    signal.throwIfAborted();

    const {api, builderIndex, hasPayload, ledger, signer} = this.modules;
    if (bid.builderIndex !== builderIndex) {
      throw new BidPublisherError(
        {
          code: BidPublisherErrorCode.BUILDER_INDEX_MISMATCH,
          builderIndex,
          bidBuilderIndex: bid.builderIndex,
        },
        `Bid Builder index does not match local Builder index builderIndex=${builderIndex} bidBuilderIndex=${bid.builderIndex}`
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

    const signedExecutionPayloadBid = signer.signExecutionPayloadBid(bid);
    ledger.recordBid({...identity, valueGwei: bid.value});

    const response = await api.beacon.publishExecutionPayloadBid({signedExecutionPayloadBid}, {signal});
    response.assertOk();
    return signedExecutionPayloadBid;
  }
}
