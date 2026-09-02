import {type ApiClient, routes} from "@lodestar/api";
import type {BuilderIndex, RootHex, Slot, gloas} from "@lodestar/types";
import {LodestarError, toRootHex} from "@lodestar/utils";
import type {BidLedger} from "./bidLedger.js";
import type {BuilderSigner} from "./builderSigner.js";

export type EnvelopeSelectionIdentity = {
  slot: Slot;
  parentBlockHash: RootHex;
  parentBlockRoot: RootHex;
  blockHash: RootHex;
  blockRoot: RootHex;
};

export type EnvelopePublicationMaterial = {
  envelope: gloas.ExecutionPayloadEnvelope;
  kzgProofs: gloas.SignedExecutionPayloadEnvelopeContents["kzgProofs"];
  blobs: gloas.SignedExecutionPayloadEnvelopeContents["blobs"];
};

export type EnvelopePublisherModules = {
  api: ApiClient;
  signer: BuilderSigner;
  ledger: BidLedger;
  builderIndex: BuilderIndex;
  hasSelection: (identity: EnvelopeSelectionIdentity) => boolean;
};

export enum EnvelopePublisherErrorCode {
  BUILDER_INDEX_MISMATCH = "ENVELOPE_PUBLISHER_ERROR_BUILDER_INDEX_MISMATCH",
  SELECTION_NOT_RECORDED = "ENVELOPE_PUBLISHER_ERROR_SELECTION_NOT_RECORDED",
}

export type EnvelopePublisherErrorType =
  | {
      code: EnvelopePublisherErrorCode.BUILDER_INDEX_MISMATCH;
      builderIndex: BuilderIndex;
      envelopeBuilderIndex: BuilderIndex;
    }
  | ({code: EnvelopePublisherErrorCode.SELECTION_NOT_RECORDED} & EnvelopeSelectionIdentity);

export class EnvelopePublisherError extends LodestarError<EnvelopePublisherErrorType> {}

export type EnvelopePublicationResult =
  | {status: "published"; signedEnvelope: gloas.SignedExecutionPayloadEnvelope}
  | {status: "duplicate"};

/** Signs and submits stateless envelope material for an exact recorded local selection. */
export class EnvelopePublisher {
  constructor(private readonly modules: EnvelopePublisherModules) {}

  async publish(material: EnvelopePublicationMaterial, signal: AbortSignal): Promise<EnvelopePublicationResult> {
    signal.throwIfAborted();

    const {api, builderIndex, hasSelection, ledger, signer} = this.modules;
    const {envelope} = material;
    if (envelope.builderIndex !== builderIndex) {
      throw new EnvelopePublisherError(
        {
          code: EnvelopePublisherErrorCode.BUILDER_INDEX_MISMATCH,
          builderIndex,
          envelopeBuilderIndex: envelope.builderIndex,
        },
        `Envelope Builder index does not match local Builder index builderIndex=${builderIndex} envelopeBuilderIndex=${envelope.builderIndex}`
      );
    }

    const identity: EnvelopeSelectionIdentity = {
      slot: envelope.payload.slotNumber,
      parentBlockHash: toRootHex(envelope.payload.parentHash),
      parentBlockRoot: toRootHex(envelope.parentBeaconBlockRoot),
      blockHash: toRootHex(envelope.payload.blockHash),
      blockRoot: toRootHex(envelope.beaconBlockRoot),
    };
    if (!hasSelection(identity)) {
      throw new EnvelopePublisherError(
        {code: EnvelopePublisherErrorCode.SELECTION_NOT_RECORDED, ...identity},
        `Envelope selection is not recorded slot=${identity.slot} blockRoot=${identity.blockRoot} blockHash=${identity.blockHash}`
      );
    }

    if (ledger.hasRevealed(identity.blockRoot)) {
      if (!ledger.canReveal(identity.blockRoot, identity.blockHash)) {
        ledger.recordReveal(identity.slot, identity.blockRoot, identity.blockHash);
      }
      return {status: "duplicate"};
    }

    const signedEnvelope = signer.signExecutionPayloadEnvelope(envelope);
    ledger.recordReveal(identity.slot, identity.blockRoot, identity.blockHash);

    const response = await api.beacon.publishExecutionPayloadEnvelope(
      {
        signedEnvelopeOrContents: {
          signedExecutionPayloadEnvelope: signedEnvelope,
          kzgProofs: material.kzgProofs,
          blobs: material.blobs,
        },
        broadcastValidation: routes.beacon.BroadcastValidation.consensusAndEquivocation,
      },
      {signal}
    );
    response.assertOk();
    return {status: "published", signedEnvelope};
  }
}
