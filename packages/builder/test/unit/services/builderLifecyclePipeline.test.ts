import {describe, expect, it, vi} from "vitest";
import {SecretKey, Signature, verify} from "@chainsafe/lodestar-z/blst";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {getExecutionPayloadEnvelopeSigningRoot} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BidLedger} from "../../../src/services/bidLedger.js";
import {BidPublisher} from "../../../src/services/bidPublisher.js";
import {BidSelector, BidSelectorErrorCode} from "../../../src/services/bidSelector.js";
import {BuilderSigner} from "../../../src/services/builderSigner.js";
import {EnvelopePublisher} from "../../../src/services/envelopePublisher.js";
import {createExecutionPayloadBid} from "../../../src/services/executionPayloadBid.js";
import {createExecutionPayloadEnvelopeContents} from "../../../src/services/executionPayloadEnvelope.js";
import type {BuiltPayload} from "../../../src/services/payloadSource.js";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {getApiClientStub, mockApiResponse} from "../utils/apiStub.js";

describe("Builder lifecycle component pipeline", () => {
  it.each(["selected", "changed_bid", "expired_payload"] as const)(
    "runs the retained payload pipeline: %s",
    async (outcome) => {
      const config = createBeaconConfig(getConfig(ForkName.gloas), Buffer.alloc(32, 1));
      const signer = new BuilderSigner(config, keypair(Buffer.alloc(32, 2)));
      const builderIndex = 7;
      const slot = 10;
      const parentBlockRoot = Buffer.alloc(32, 3);
      const payload = createBuiltPayload();
      const blockHash = toRootHex(payload.executionPayload.blockHash);
      const store = new PayloadStore();
      const storedPayload = {slot, parentBlockRoot, blockHash, payload};
      store.add(storedPayload);

      const bid = createExecutionPayloadBid({
        slot,
        parentBlockRoot,
        prevRandao: ssz.gloas.PayloadAttributes.defaultValue().prevRandao,
        builderIndex,
        feeRecipient: Buffer.alloc(20, 4),
        value: 5,
        payload: {...payload, fork: ForkName.gloas},
      });
      const api = getApiClientStub();
      Object.assign(api.beacon, {
        publishExecutionPayloadBid: vi.fn(),
        publishExecutionPayloadEnvelope: vi.fn(),
      });
      api.beacon.publishExecutionPayloadBid.mockResolvedValue(mockApiResponse({}));
      api.beacon.publishExecutionPayloadEnvelope.mockResolvedValue(mockApiResponse({}));
      const ledger = new BidLedger();
      const publisher = new BidPublisher({
        api,
        config,
        signer,
        ledger,
        builderIndex,
        hasPayload: (identity) => {
          const stored = store.get(identity.blockHash);
          return (
            stored !== null &&
            stored.slot === identity.slot &&
            toRootHex(stored.parentBlockRoot) === identity.parentBlockRoot &&
            toRootHex(stored.payload.executionPayload.parentHash) === identity.parentBlockHash
          );
        },
      });
      const signedBid = await publisher.publish(bid, new AbortController().signal);

      const block = ssz.gloas.SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      block.message.body.signedExecutionPayloadBid = ssz.gloas.SignedExecutionPayloadBid.clone(signedBid);
      if (outcome === "changed_bid") block.message.body.signedExecutionPayloadBid.message.value++;
      if (outcome === "expired_payload") store.prune(slot + 3);
      const blockRoot = toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message));
      const selector = new BidSelector({
        config,
        ledger,
        builderIndex,
      });
      if (outcome === "changed_bid") {
        expect(() => selector.match({blockRoot, slot, version: ForkName.gloas, block})).toThrow(
          expect.objectContaining({type: expect.objectContaining({code: BidSelectorErrorCode.UNKNOWN_BID})})
        );
        expect(ledger.getBidsForSlot(slot)[0].wonBlockRoots).toEqual([]);
        expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
        return;
      }
      const selection = selector.match({blockRoot, slot, version: ForkName.gloas, block});
      if (outcome === "expired_payload") {
        expect(selection.status).toBe("selected");
        expect(ledger.getBidsForSlot(slot)[0].wonBlockRoots).toEqual([blockRoot]);
        expect(store.get(blockHash)).toBeNull();
        expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
        return;
      }
      if (selection.status !== "selected") {
        throw Error(`Expected selected bid, got ${selection.reason}`);
      }

      const stored = store.get(blockHash);
      if (stored === null) {
        throw Error("Expected retained payload");
      }
      const contents = createExecutionPayloadEnvelopeContents({
        blockRoot,
        builderIndex,
        selectedBid: block.message.body.signedExecutionPayloadBid.message,
        storedPayload: stored,
      });
      const envelopePublisher = new EnvelopePublisher({
        api,
        signer,
        ledger,
        builderIndex,
      });
      const publication = await envelopePublisher.publish(contents, new AbortController().signal);
      if (publication.status !== "published") {
        throw Error("Expected envelope publication");
      }

      expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
      expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledOnce();
      expect(selection.bid.wonBlockRoots).toEqual([blockRoot]);
      expect(publication.signedEnvelope.message.payload).toBe(payload.executionPayload);
      expect(publication.signedEnvelope.message.executionRequests).toBe(payload.executionRequests);
      expect(api.beacon.publishExecutionPayloadEnvelope.mock.calls[0][0].signedEnvelopeOrContents).toMatchObject({
        kzgProofs: payload.blobsBundle.proofs,
        blobs: payload.blobsBundle.blobs,
      });
      expect(
        verify(
          getExecutionPayloadEnvelopeSigningRoot(config, publication.signedEnvelope.message),
          keypair(Buffer.alloc(32, 2)).publicKey,
          Signature.fromBytes(publication.signedEnvelope.signature, true)
        )
      ).toBe(true);
    }
  );
});

function createBuiltPayload(): BuiltPayload {
  const executionPayload = ssz.gloas.ExecutionPayload.defaultValue();
  executionPayload.slotNumber = 10;
  executionPayload.parentHash = Buffer.alloc(32, 5);
  executionPayload.blockHash = Buffer.alloc(32, 6);
  const blobsBundle = ssz.gloas.BlobsBundle.defaultValue();
  blobsBundle.blobs.push(ssz.deneb.Blob.defaultValue());
  blobsBundle.commitments.push(Buffer.alloc(48, 1));
  blobsBundle.proofs.push(Buffer.alloc(48, 2));
  return {
    sourceId: "engine",
    fork: ForkName.gloas,
    executionPayload,
    executionRequests: ssz.gloas.ExecutionRequests.defaultValue(),
    blobsBundle,
    executionPayloadValue: 10_000_000_000n,
  };
}

function keypair(secretKeyBytes: Uint8Array) {
  const secretKey = SecretKey.fromBytes(secretKeyBytes);
  return {secretKey, publicKey: secretKey.toPublicKey()};
}
