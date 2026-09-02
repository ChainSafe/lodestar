import type {ApiClient} from "@lodestar/api";
import type {BuilderIndex, RootHex, gloas} from "@lodestar/types";
import {LodestarError, toRootHex} from "@lodestar/utils";
import type {BidLedger} from "./bidLedger.js";
import type {BuilderSigner} from "./builderSigner.js";

export type BidPublisherModules = {
  api: ApiClient;
  signer: BuilderSigner;
  ledger: BidLedger;
  builderIndex: BuilderIndex;
  hasPayload: (blockHash: RootHex) => boolean;
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

    const blockHash = toRootHex(bid.blockHash);
    if (!hasPayload(blockHash)) {
      throw new BidPublisherError(
        {code: BidPublisherErrorCode.PAYLOAD_NOT_RETAINED, blockHash},
        `Bid payload is not retained blockHash=${blockHash}`
      );
    }

    const signedExecutionPayloadBid = signer.signExecutionPayloadBid(bid);
    ledger.recordBid({
      slot: bid.slot,
      parentBlockHash: toRootHex(bid.parentBlockHash),
      parentBlockRoot: toRootHex(bid.parentBlockRoot),
      blockHash,
      valueGwei: bid.value,
    });

    const response = await api.beacon.publishExecutionPayloadBid({signedExecutionPayloadBid}, {signal});
    response.assertOk();
    return signedExecutionPayloadBid;
  }
}
