import {describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {HttpStatusCode, routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {defer, toRootHex} from "@lodestar/utils";
import {BidLedger, BidLedgerErrorCode} from "../../../src/services/bidLedger.js";
import {BuilderSigner} from "../../../src/services/builderSigner.js";
import {
  EnvelopePublisher,
  EnvelopePublisherError,
  EnvelopePublisherErrorCode,
  type EnvelopeSelectionIdentity,
} from "../../../src/services/envelopePublisher.js";
import type {ExecutionPayloadEnvelopeContents} from "../../../src/services/executionPayloadEnvelope.js";
import {getApiClientStub, mockApiErrorResponse, mockApiResponse} from "../utils/apiStub.js";

const builderIndex = 7;
const signer = new BuilderSigner(
  createBeaconConfig(getConfig(ForkName.gloas), Buffer.alloc(32, 9)),
  keypair(Buffer.alloc(32, 1))
);

describe("EnvelopePublisher", () => {
  it("signs, records, and submits an exact selected envelope", async () => {
    const contents = createContents();
    const {api, ledger, publisher} = createPublisher();

    const result = await publisher.publish(contents, new AbortController().signal);

    expect(result.status).toBe("published");
    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledWith(
      {
        signedEnvelopeOrContents: {
          signedExecutionPayloadEnvelope: expect.objectContaining({message: contents.envelope}),
          kzgProofs: contents.kzgProofs,
          blobs: contents.blobs,
        },
        broadcastValidation: routes.beacon.BroadcastValidation.gossip,
      },
      {signal: expect.any(AbortSignal)}
    );
    const identity = selectionIdentity(contents);
    expect(ledger.hasRevealed(identity.blockRoot)).toBe(true);
    expect(ledger.hasPublishedReveal(identity.blockRoot)).toBe(true);
  });

  it("rejects an envelope for another Builder before publication", async () => {
    const contents = createContents();
    contents.envelope.builderIndex++;
    const {api, ledger, publisher} = createPublisher();

    await expect(publisher.publish(contents, new AbortController().signal)).rejects.toThrowError(
      new EnvelopePublisherError(
        {
          code: EnvelopePublisherErrorCode.BUILDER_INDEX_MISMATCH,
          builderIndex,
          envelopeBuilderIndex: contents.envelope.builderIndex,
        },
        `Envelope builder index does not match local builder index builderIndex=${builderIndex} envelopeBuilderIndex=${contents.envelope.builderIndex}`
      )
    );
    expect(ledger.hasRevealed(toRootHex(contents.envelope.beaconBlockRoot))).toBe(false);
    expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
  });

  it("rejects an envelope without an exact recorded selection", async () => {
    const contents = createContents();
    const identity = selectionIdentity(contents);
    const {api, ledger, publisher} = createPublisher({win: false});

    await expect(publisher.publish(contents, new AbortController().signal)).rejects.toThrowError(
      new EnvelopePublisherError(
        {code: EnvelopePublisherErrorCode.SELECTION_NOT_RECORDED, ...identity},
        `Envelope selection is not recorded slot=${identity.slot} blockRoot=${identity.blockRoot} blockHash=${identity.blockHash}`
      )
    );
    expect(ledger.hasRevealed(identity.blockRoot)).toBe(false);
    expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
  });

  it("rejects an already aborted call without side effects", async () => {
    const controller = new AbortController();
    controller.abort();
    const contents = createContents();
    const {api, ledger, publisher} = createPublisher();
    const hasWon = vi.spyOn(ledger, "hasWon");

    await expect(publisher.publish(contents, controller.signal)).rejects.toMatchObject({name: "AbortError"});
    expect(hasWon).not.toHaveBeenCalled();
    expect(ledger.hasRevealed(toRootHex(contents.envelope.beaconBlockRoot))).toBe(false);
    expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
  });

  it("does not sign or submit an exact duplicate reveal", async () => {
    const contents = createContents();
    const {api, publisher} = createPublisher();
    const signal = new AbortController().signal;
    await publisher.publish(contents, signal);

    await expect(publisher.publish(contents, signal)).resolves.toEqual({status: "duplicate"});
    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledOnce();
  });

  it("shares one active publication for concurrent identical calls", async () => {
    const contents = createContents();
    const {api, publisher} = createPublisher();
    const response = defer<Awaited<ReturnType<typeof api.beacon.publishExecutionPayloadEnvelope>>>();
    api.beacon.publishExecutionPayloadEnvelope.mockReturnValue(response.promise);
    const signal = new AbortController().signal;

    const first = publisher.publish(contents, signal);
    const duplicate = publisher.publish(contents, signal);
    response.resolve(mockApiResponse({}));

    await expect(first).resolves.toMatchObject({status: "published"});
    await expect(duplicate).resolves.toMatchObject({status: "published"});
    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledOnce();
  });

  it.each([0, 1])("cancels caller %i without canceling the other caller", async (abortedIndex) => {
    const contents = createContents();
    const {api, publisher} = createPublisher();
    const response = defer<Awaited<ReturnType<typeof api.beacon.publishExecutionPayloadEnvelope>>>();
    api.beacon.publishExecutionPayloadEnvelope.mockReturnValue(response.promise);
    const controllers = [new AbortController(), new AbortController()];
    const calls = controllers.map((controller) => publisher.publish(contents, controller.signal));
    const reason = new Error("caller canceled");
    const rejected = expect(calls[abortedIndex]).rejects.toBe(reason);

    controllers[abortedIndex].abort(reason);
    response.resolve(mockApiResponse({}));

    await rejected;
    await expect(calls[1 - abortedIndex]).resolves.toMatchObject({status: "published"});
    expect(api.beacon.publishExecutionPayloadEnvelope.mock.calls[0][1]?.signal?.aborted).toBe(false);
    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledOnce();
  });

  it("aborts the request after the last waiter cancels and records a late success", async () => {
    const contents = createContents();
    const {api, ledger, publisher} = createPublisher();
    const response = defer<Awaited<ReturnType<typeof api.beacon.publishExecutionPayloadEnvelope>>>();
    api.beacon.publishExecutionPayloadEnvelope.mockReturnValueOnce(response.promise);
    const controllers = [new AbortController(), new AbortController()];
    const calls = controllers.map((controller) => publisher.publish(contents, controller.signal));
    const results = Promise.allSettled(calls);
    for (const controller of controllers) controller.abort();
    expect((await results).map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(api.beacon.publishExecutionPayloadEnvelope.mock.calls[0][1]?.signal?.aborted).toBe(true);

    const identity = selectionIdentity(contents);
    expect(ledger.hasRevealed(identity.blockRoot)).toBe(true);
    expect(ledger.hasPublishedReveal(identity.blockRoot)).toBe(false);
    const retryResponse = defer<Awaited<ReturnType<typeof api.beacon.publishExecutionPayloadEnvelope>>>();
    api.beacon.publishExecutionPayloadEnvelope.mockReturnValueOnce(retryResponse.promise);
    const retry = publisher.publish(contents, new AbortController().signal);
    const lateResponse: Awaited<ReturnType<typeof api.beacon.publishExecutionPayloadEnvelope>> = mockApiResponse({});
    const assertOk = vi.spyOn(lateResponse, "assertOk");
    response.resolve(lateResponse);
    await vi.waitFor(() => expect(assertOk).toHaveBeenCalledOnce());
    expect(ledger.hasPublishedReveal(identity.blockRoot)).toBe(true);

    const duplicateRetry = publisher.publish(contents, new AbortController().signal);
    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledTimes(2);
    retryResponse.resolve(mockApiResponse({}));
    await expect(retry).resolves.toMatchObject({status: "published"});
    await expect(duplicateRetry).resolves.toEqual({status: "duplicate"});
    expect(ledger.hasPublishedReveal(identity.blockRoot)).toBe(true);
  });

  it("cancels all waiters sharing a signal", async () => {
    const contents = createContents();
    const {api, publisher} = createPublisher();
    const response = defer<Awaited<ReturnType<typeof api.beacon.publishExecutionPayloadEnvelope>>>();
    api.beacon.publishExecutionPayloadEnvelope.mockReturnValue(response.promise);
    const controller = new AbortController();
    const calls = [publisher.publish(contents, controller.signal), publisher.publish(contents, controller.signal)];
    const results = Promise.allSettled(calls);
    controller.abort();

    expect((await results).map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(api.beacon.publishExecutionPayloadEnvelope.mock.calls[0][1]?.signal?.aborted).toBe(true);
    response.reject(controller.signal.reason);
  });

  it.each([true, false])("removes caller abort listeners after success=%s", async (success) => {
    const contents = createContents();
    const {api, publisher} = createPublisher();
    const response = defer<Awaited<ReturnType<typeof api.beacon.publishExecutionPayloadEnvelope>>>();
    api.beacon.publishExecutionPayloadEnvelope.mockReturnValue(response.promise);
    const controllers = [new AbortController(), new AbortController()];
    const addListeners = controllers.map((controller) => vi.spyOn(controller.signal, "addEventListener"));
    const removeListeners = controllers.map((controller) => vi.spyOn(controller.signal, "removeEventListener"));
    const calls = controllers.map((controller) => publisher.publish(contents, controller.signal));
    const results = Promise.allSettled(calls);
    if (success) response.resolve(mockApiResponse({}));
    else response.reject(new Error("publication failed"));
    expect((await results).map((result) => result.status)).toEqual(
      success ? ["fulfilled", "fulfilled"] : ["rejected", "rejected"]
    );
    for (let i = 0; i < controllers.length; i++) {
      expect(removeListeners[i], `caller ${i} listener cleanup`).toHaveBeenCalledWith(
        "abort",
        addListeners[i].mock.calls[0][1]
      );
    }
  });

  it("retries the same reserved envelope after the Beacon Node rejects publication", async () => {
    const contents = createContents();
    const {api, ledger, publisher} = createPublisher();
    api.beacon.publishExecutionPayloadEnvelope.mockResolvedValue(
      await mockApiErrorResponse(HttpStatusCode.BAD_REQUEST)
    );

    await expect(publisher.publish(contents, new AbortController().signal)).rejects.toThrowError(
      expect.objectContaining({status: HttpStatusCode.BAD_REQUEST})
    );
    const identity = selectionIdentity(contents);
    expect(ledger.hasRevealed(identity.blockRoot)).toBe(true);
    expect(ledger.hasPublishedReveal(identity.blockRoot)).toBe(false);

    api.beacon.publishExecutionPayloadEnvelope.mockResolvedValue(mockApiResponse({}));
    await expect(publisher.publish(contents, new AbortController().signal)).resolves.toMatchObject({
      status: "published",
    });
    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledTimes(2);
    expect(ledger.hasPublishedReveal(identity.blockRoot)).toBe(true);
  });

  it("rejects changed envelope contents after a failed publication", async () => {
    const contents = createContents();
    const {api, publisher} = createPublisher();
    api.beacon.publishExecutionPayloadEnvelope.mockResolvedValue(
      await mockApiErrorResponse(HttpStatusCode.BAD_REQUEST)
    );
    await expect(publisher.publish(contents, new AbortController().signal)).rejects.toThrowError(
      expect.objectContaining({status: HttpStatusCode.BAD_REQUEST})
    );

    const changedContents = createContents();
    changedContents.envelope.executionRequests.deposits.push(ssz.electra.DepositRequest.defaultValue());

    await expect(publisher.publish(changedContents, new AbortController().signal)).rejects.toMatchObject({
      type: {code: BidLedgerErrorCode.REVEAL_CONFLICT},
    });
    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledOnce();
  });
});

function createPublisher({win = true}: {win?: boolean} = {}) {
  const api = getApiClientStub();
  Object.assign(api.beacon, {publishExecutionPayloadEnvelope: vi.fn()});
  api.beacon.publishExecutionPayloadEnvelope.mockResolvedValue(mockApiResponse({}));
  const ledger = new BidLedger();
  const {blockRoot, ...bidIdentity} = selectionIdentity(createContents());
  const signedBidRoot = toRootHex(Buffer.alloc(32, 11));
  ledger.recordBid({...bidIdentity, valueGwei: 1, signedBidRoot});
  if (win) {
    ledger.recordWin({...bidIdentity, signedBidRoot}, blockRoot);
  }
  const publisher = new EnvelopePublisher({api, signer, ledger, builderIndex});
  return {api, ledger, publisher};
}

function createContents(): ExecutionPayloadEnvelopeContents {
  const envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();
  envelope.builderIndex = builderIndex;
  envelope.payload.slotNumber = 10;
  envelope.payload.parentHash = Buffer.alloc(32, 2);
  envelope.parentBeaconBlockRoot = Buffer.alloc(32, 3);
  envelope.payload.blockHash = Buffer.alloc(32, 4);
  envelope.beaconBlockRoot = Buffer.alloc(32, 8);
  return {
    envelope,
    kzgProofs: [Buffer.alloc(48, 5)],
    blobs: [Buffer.alloc(0)],
  };
}

function selectionIdentity(contents: ExecutionPayloadEnvelopeContents): EnvelopeSelectionIdentity {
  return {
    slot: contents.envelope.payload.slotNumber,
    parentBlockHash: toRootHex(contents.envelope.payload.parentHash),
    parentBlockRoot: toRootHex(contents.envelope.parentBeaconBlockRoot),
    blockHash: toRootHex(contents.envelope.payload.blockHash),
    blockRoot: toRootHex(contents.envelope.beaconBlockRoot),
  };
}

function keypair(secretKeyBytes: Uint8Array) {
  const secretKey = SecretKey.fromBytes(secretKeyBytes);
  return {secretKey, publicKey: secretKey.toPublicKey()};
}
