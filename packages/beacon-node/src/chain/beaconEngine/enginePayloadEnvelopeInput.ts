import {ForkName} from "@lodestar/params";
import {RootHex, Slot, ValidatorIndex, deneb, gloas} from "@lodestar/types";
import {LodestarError, toRootHex} from "@lodestar/utils";
import {
  AddPayloadEnvelopeProps,
  CreateFromBidProps,
  CreateFromBlockProps,
  SourceMeta,
} from "../blocks/payloadEnvelopeInput/types.js";

export type CreateEnginePayloadEnvelopeInputFromBlockProps = Pick<
  CreateFromBlockProps,
  "blockRootHex" | "block" | "forkName"
>;

export type CreateEnginePayloadEnvelopeInputFromBidProps = Pick<
  CreateFromBidProps,
  "blockRootHex" | "slot" | "forkName" | "proposerIndex" | "bid"
>;

/**
 * Source: unstable@0edec865c8 chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.ts.
 * Holds a block bid and a validated candidate; fork choice determines whether the payload is imported.
 */
export class EnginePayloadEnvelopeInput {
  readonly blockRootHex: RootHex;
  readonly slot: Slot;
  readonly forkName: ForkName;
  readonly proposerIndex: ValidatorIndex;
  readonly bid: gloas.ExecutionPayloadBid;

  private payloadEnvelope?: gloas.SignedExecutionPayloadEnvelope;
  private payloadEnvelopeSource?: SourceMeta;

  private constructor(props: CreateEnginePayloadEnvelopeInputFromBidProps) {
    this.blockRootHex = props.blockRootHex;
    this.slot = props.slot;
    this.forkName = props.forkName;
    this.proposerIndex = props.proposerIndex;
    this.bid = props.bid;
  }

  static createFromBlock(props: CreateEnginePayloadEnvelopeInputFromBlockProps): EnginePayloadEnvelopeInput {
    return new EnginePayloadEnvelopeInput({
      blockRootHex: props.blockRootHex,
      slot: props.block.message.slot,
      forkName: props.forkName,
      proposerIndex: props.block.message.proposerIndex,
      bid: props.block.message.body.signedExecutionPayloadBid.message,
    });
  }

  static createFromBid(props: CreateEnginePayloadEnvelopeInputFromBidProps): EnginePayloadEnvelopeInput {
    return new EnginePayloadEnvelopeInput(props);
  }

  getBid(): gloas.ExecutionPayloadBid {
    return this.bid;
  }

  getBuilderIndex(): ValidatorIndex {
    return this.bid.builderIndex;
  }

  getBlockHashHex(): RootHex {
    return toRootHex(this.bid.blockHash);
  }

  getBlobKzgCommitments(): deneb.BlobKzgCommitments {
    return this.bid.blobKzgCommitments;
  }

  addPayloadEnvelope({envelope, ...source}: AddPayloadEnvelopeProps): void {
    if (toRootHex(envelope.message.beaconBlockRoot) !== this.blockRootHex) {
      throw new LodestarError({code: "PAYLOAD_ENVELOPE_BLOCK_ROOT_MISMATCH", blockRootHex: this.blockRootHex});
    }
    // Validation can accept another envelope until fork choice marks the payload FULL.
    this.payloadEnvelope = envelope;
    this.payloadEnvelopeSource = source;
  }

  hasPayloadEnvelope(): boolean {
    return this.payloadEnvelope !== undefined;
  }

  getPayloadEnvelope(): gloas.SignedExecutionPayloadEnvelope {
    if (!this.payloadEnvelope) {
      throw new LodestarError({code: "PAYLOAD_ENVELOPE_MISSING", blockRootHex: this.blockRootHex});
    }
    return this.payloadEnvelope;
  }

  getPayloadEnvelopeSource(): SourceMeta {
    if (!this.payloadEnvelopeSource) {
      throw new LodestarError({code: "PAYLOAD_ENVELOPE_MISSING", blockRootHex: this.blockRootHex});
    }
    return this.payloadEnvelopeSource;
  }
}
