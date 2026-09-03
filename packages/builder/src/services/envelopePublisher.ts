import {type ApiClient, routes} from "@lodestar/api";
import {type BuilderIndex, type RootHex, type Slot, type gloas, ssz} from "@lodestar/types";
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
  private readonly activePublications = new Map<RootHex, Promise<EnvelopePublicationResult>>();

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

    const envelopeRoot = toRootHex(ssz.gloas.ExecutionPayloadEnvelope.hashTreeRoot(envelope));
    ledger.recordReveal(identity.slot, identity.blockRoot, identity.blockHash, envelopeRoot);
    if (ledger.hasPublishedReveal(identity.blockRoot)) {
      return {status: "duplicate"};
    }

    const activePublication = this.activePublications.get(identity.blockRoot);
    if (activePublication !== undefined) {
      return activePublication;
    }

    const publication = this.publishEnvelope(material, identity, envelopeRoot, api, ledger, signer, signal).finally(
      () => {
        if (this.activePublications.get(identity.blockRoot) === publication) {
          this.activePublications.delete(identity.blockRoot);
        }
      }
    );
    this.activePublications.set(identity.blockRoot, publication);
    return publication;
  }

  private async publishEnvelope(
    material: EnvelopePublicationMaterial,
    identity: EnvelopeSelectionIdentity,
    envelopeRoot: RootHex,
    api: ApiClient,
    ledger: BidLedger,
    signer: BuilderSigner,
    signal: AbortSignal
  ): Promise<EnvelopePublicationResult> {
    const signedEnvelope = signer.signExecutionPayloadEnvelope(material.envelope);

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
    ledger.recordRevealPublished(identity.slot, identity.blockRoot, identity.blockHash, envelopeRoot);
    return {status: "published", signedEnvelope};
  }
}
