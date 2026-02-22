import type {RootHex, Slot, ValidatorIndex, gloas} from "@lodestar/types";

export type BidInfo = {
  blockRootHex: RootHex;
  slot: Slot;
  builderIndex: ValidatorIndex;
  blockHashFromBid: RootHex;
};

/**
 * Represents the envelope pipeline context for a Gloas block.
 * Created from the bid in the beacon block body as soon as the block passes gossip validation.
 * The bid is needed for gossip validation of both the envelope and data columns.
 */
export class PayloadEnvelopeInput {
  readonly blockRootHex: RootHex;
  readonly slot: Slot;
  readonly builderIndex: ValidatorIndex;
  readonly blockHashFromBid: RootHex;

  private _envelope: gloas.SignedExecutionPayloadEnvelope | null = null;

  private constructor(bid: BidInfo) {
    this.blockRootHex = bid.blockRootHex;
    this.slot = bid.slot;
    this.builderIndex = bid.builderIndex;
    this.blockHashFromBid = bid.blockHashFromBid;
  }

  /**
   * The only way to create a PayloadEnvelopeInput.
   * The bid is required for gossip validation of both the envelope and data columns.
   */
  static createFromBid(bid: BidInfo): PayloadEnvelopeInput {
    return new PayloadEnvelopeInput(bid);
  }

  hasEnvelope(): boolean {
    return this._envelope !== null;
  }

  setEnvelope(envelope: gloas.SignedExecutionPayloadEnvelope): void {
    this._envelope = envelope;
  }

  getEnvelope(): gloas.SignedExecutionPayloadEnvelope {
    if (this._envelope === null) {
      throw Error(`PayloadEnvelopeInput has no envelope for blockRoot=${this.blockRootHex}`);
    }
    return this._envelope;
  }
}
