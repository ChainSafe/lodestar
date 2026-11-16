import {type ApiClient, routes} from "@lodestar/api";
import {type RootHex, type gloas, ssz} from "@lodestar/types";
import {LodestarError, defer, toRootHex} from "@lodestar/utils";
import type {BidIdentity, BidLedger} from "./bidLedger.js";

export type EnvelopeSelectionIdentity = BidIdentity & {blockRoot: RootHex};

export type EnvelopePublisherModules = {
  api: ApiClient;
  ledger: BidLedger;
};

export enum EnvelopePublisherErrorCode {
  SELECTION_NOT_RECORDED = "ENVELOPE_PUBLISHER_ERROR_SELECTION_NOT_RECORDED",
}

export type EnvelopePublisherErrorType = {
  code: EnvelopePublisherErrorCode.SELECTION_NOT_RECORDED;
} & EnvelopeSelectionIdentity;

export class EnvelopePublisherError extends LodestarError<EnvelopePublisherErrorType> {}

export type EnvelopePublicationResult =
  | {status: "published"; envelope: gloas.ExecutionPayloadEnvelope}
  | {status: "duplicate"};

type ActivePublication = {
  controller: AbortController;
  promise: Promise<EnvelopePublicationResult>;
  waiters: number;
};

/** Submits an envelope for a recorded local selection. */
export class EnvelopePublisher {
  private readonly activePublications = new Map<RootHex, ActivePublication>();

  constructor(private readonly modules: EnvelopePublisherModules) {}

  async publish(
    contents: gloas.ExecutionPayloadEnvelopeContents,

    signal: AbortSignal
  ): Promise<EnvelopePublicationResult> {
    signal.throwIfAborted();

    const {api, ledger} = this.modules;
    const {executionPayloadEnvelope: envelope} = contents;

    const identity: EnvelopeSelectionIdentity = {
      slot: envelope.payload.slotNumber,
      parentBlockHash: toRootHex(envelope.payload.parentHash),
      parentBlockRoot: toRootHex(envelope.parentBeaconBlockRoot),
      blockHash: toRootHex(envelope.payload.blockHash),
      blockRoot: toRootHex(envelope.beaconBlockRoot),
    };
    if (!ledger.hasWon(identity, identity.blockRoot)) {
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
        promise: this.publishEnvelope(contents, identity, envelopeRoot, api, ledger, controller.signal).finally(() => {
          if (this.activePublications.get(identity.blockRoot)?.controller === controller) {
            this.activePublications.delete(identity.blockRoot);
          }
        }),
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
    contents: gloas.ExecutionPayloadEnvelopeContents,
    identity: EnvelopeSelectionIdentity,
    envelopeRoot: RootHex,
    api: ApiClient,
    ledger: BidLedger,
    signal: AbortSignal
  ): Promise<EnvelopePublicationResult> {
    const response = await api.beacon.publishExecutionPayloadEnvelope(
      {
        executionPayloadEnvelopeContents: contents,
        broadcastValidation: routes.beacon.BroadcastValidation.gossip,
      },
      {signal}
    );
    response.assertOk();
    ledger.recordRevealPublished(identity.slot, identity.blockRoot, identity.blockHash, envelopeRoot);
    return {status: "published", envelope: contents.executionPayloadEnvelope};
  }
}
