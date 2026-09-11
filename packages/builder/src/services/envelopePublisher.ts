import {type ApiClient, routes} from "@lodestar/api";
import {type BuilderIndex, type RootHex, type Slot, type gloas, ssz} from "@lodestar/types";
import {LodestarError, defer, toRootHex} from "@lodestar/utils";
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

type ActivePublication = {
  controller: AbortController;
  promise: Promise<EnvelopePublicationResult>;
  waiters: number;
};

/** Signs and submits stateless envelope material for an exact recorded local selection. */
export class EnvelopePublisher {
  private readonly activePublications = new Map<RootHex, ActivePublication>();

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

    let publication = this.activePublications.get(identity.blockRoot);
    if (publication === undefined) {
      const controller = new AbortController();
      publication = {
        controller,
        waiters: 0,
        promise: this.publishEnvelope(material, identity, envelopeRoot, api, ledger, signer, controller.signal).finally(
          () => {
            if (this.activePublications.get(identity.blockRoot)?.controller === controller) {
              this.activePublications.delete(identity.blockRoot);
            }
          }
        ),
      };
      this.activePublications.set(identity.blockRoot, publication);
    }
    return this.waitForPublication(identity.blockRoot, publication, signal);
  }

  private async waitForPublication(
    blockRoot: RootHex,
    publication: ActivePublication,
    signal: AbortSignal
  ): Promise<EnvelopePublicationResult> {
    const aborted = defer<never>();
    const onAbort = (): void => aborted.reject(signal.reason);
    publication.waiters++;
    signal.addEventListener("abort", onAbort, {once: true});
    if (signal.aborted) onAbort();

    try {
      return await Promise.race([publication.promise, aborted.promise]);
    } finally {
      signal.removeEventListener("abort", onAbort);
      publication.waiters--;
      if (publication.waiters === 0 && signal.aborted) {
        if (this.activePublications.get(blockRoot) === publication) {
          this.activePublications.delete(blockRoot);
        }
        publication.controller.abort(signal.reason);
      }
    }
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
    signal.throwIfAborted();
    ledger.recordRevealPublished(identity.slot, identity.blockRoot, identity.blockHash, envelopeRoot);
    return {status: "published", signedEnvelope};
  }
}
