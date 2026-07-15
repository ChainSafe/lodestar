import {describe, expect, it} from "vitest";
import {ForkName} from "@lodestar/params";
import {ColumnIndex, SignedBeaconBlock, gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";

function buildPayloadInput({blobCount, sampledColumns}: {blobCount: number; sampledColumns: ColumnIndex[]}): {
  payloadInput: PayloadEnvelopeInput;
  blockRoot: Uint8Array;
} {
  const block = ssz.gloas.SignedBeaconBlock.defaultValue();
  block.message.slot = 1;
  const commitments = Array.from({length: blobCount}, () => Buffer.alloc(48, 0x77));
  block.message.body.signedExecutionPayloadBid.message.blobKzgCommitments = commitments;

  const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);

  const payloadInput = PayloadEnvelopeInput.createFromBlock({
    blockRootHex: toRootHex(blockRoot),
    block: block as SignedBeaconBlock<typeof ForkName.gloas>,
    forkName: ForkName.gloas,
    sampledColumns,
    custodyColumns: sampledColumns,
    timeCreatedSec: Date.now() / 1000,
    daOutOfRange: false,
  });

  return {payloadInput, blockRoot};
}

function buildEnvelope(blockRoot: Uint8Array, builderIndex = 0): gloas.SignedExecutionPayloadEnvelope {
  const signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
  signedEnvelope.message.beaconBlockRoot = blockRoot;
  signedEnvelope.message.builderIndex = builderIndex;
  return signedEnvelope;
}

function buildColumnSidecar(index: ColumnIndex): gloas.DataColumnSidecar {
  const columnSidecar = ssz.gloas.DataColumnSidecar.defaultValue();
  columnSidecar.index = index;
  return columnSidecar;
}

describe("PayloadEnvelopeInput", () => {
  describe("removeUnverifiedPayloadEnvelope", () => {
    it("removes an unverified envelope from the complete state", () => {
      // no blobs -> hasAllData from creation, attaching an envelope completes the input
      const {payloadInput, blockRoot} = buildPayloadInput({blobCount: 0, sampledColumns: []});
      const envelope = buildEnvelope(blockRoot);
      payloadInput.addPayloadEnvelope({
        envelope,
        source: PayloadEnvelopeInputSource.byRange,
        seenTimestampSec: Date.now() / 1000,
        peerIdStr: "peerA",
        verified: false,
      });
      expect(payloadInput.isComplete()).toBe(true);

      const removed = payloadInput.removeUnverifiedPayloadEnvelope();

      expect(removed?.envelope).toBe(envelope);
      expect(removed?.sourceMeta).toEqual({
        source: PayloadEnvelopeInputSource.byRange,
        seenTimestampSec: expect.any(Number),
        peerIdStr: "peerA",
      });
      expect(payloadInput.hasPayloadEnvelope()).toBe(false);
      expect(payloadInput.hasAllData()).toBe(true);
      expect(payloadInput.hasComputedAllData()).toBe(true);
      expect(payloadInput.isComplete()).toBe(false);
      expect(payloadInput.getSerializedCacheKeys()).not.toContain(envelope);
    });

    it("removes an unverified envelope from the envelope-only state and preserves columns", () => {
      const {payloadInput, blockRoot} = buildPayloadInput({blobCount: 1, sampledColumns: [0, 1]});
      payloadInput.addColumn({
        columnSidecar: buildColumnSidecar(0),
        source: PayloadEnvelopeInputSource.byRange,
        seenTimestampSec: Date.now() / 1000,
      });
      payloadInput.addPayloadEnvelope({
        envelope: buildEnvelope(blockRoot),
        source: PayloadEnvelopeInputSource.byRange,
        seenTimestampSec: Date.now() / 1000,
        verified: false,
      });
      expect(payloadInput.hasAllData()).toBe(false);

      const removed = payloadInput.removeUnverifiedPayloadEnvelope();

      expect(removed).not.toBeNull();
      expect(payloadInput.hasPayloadEnvelope()).toBe(false);
      expect(payloadInput.hasAllData()).toBe(false);
      expect(payloadInput.hasComputedAllData()).toBe(false);
      // previously added columns survive the detach
      expect(payloadInput.hasColumn(0)).toBe(true);
      expect(payloadInput.getMissingSampledColumnMeta().missing).toEqual([1]);
    });

    it("never removes an envelope attached as verified", () => {
      const {payloadInput, blockRoot} = buildPayloadInput({blobCount: 0, sampledColumns: []});
      const envelope = buildEnvelope(blockRoot);
      payloadInput.addPayloadEnvelope({
        envelope,
        source: PayloadEnvelopeInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
        verified: true,
      });

      expect(payloadInput.removeUnverifiedPayloadEnvelope()).toBeNull();
      expect(payloadInput.hasPayloadEnvelope()).toBe(true);
      expect(payloadInput.getPayloadEnvelope()).toBe(envelope);
    });

    it("never removes an envelope upgraded via markPayloadEnvelopeVerified", () => {
      const {payloadInput, blockRoot} = buildPayloadInput({blobCount: 0, sampledColumns: []});
      payloadInput.addPayloadEnvelope({
        envelope: buildEnvelope(blockRoot),
        source: PayloadEnvelopeInputSource.byRange,
        seenTimestampSec: Date.now() / 1000,
        verified: false,
      });
      expect(payloadInput.isPayloadEnvelopeVerified()).toBe(false);

      payloadInput.markPayloadEnvelopeVerified();

      expect(payloadInput.isPayloadEnvelopeVerified()).toBe(true);
      expect(payloadInput.removeUnverifiedPayloadEnvelope()).toBeNull();
      expect(payloadInput.hasPayloadEnvelope()).toBe(true);
    });

    it("allows re-attaching a fresh envelope after removal", async () => {
      const {payloadInput, blockRoot} = buildPayloadInput({blobCount: 0, sampledColumns: []});
      payloadInput.addPayloadEnvelope({
        envelope: buildEnvelope(blockRoot, 0),
        source: PayloadEnvelopeInputSource.byRange,
        seenTimestampSec: Date.now() / 1000,
        verified: false,
      });
      payloadInput.removeUnverifiedPayloadEnvelope();

      // the wait below must observe the replacement envelope, not the removed one
      const waitPromise = payloadInput.waitForEnvelopeAndAllData(1_000);

      const freshEnvelope = buildEnvelope(blockRoot, 1);
      expect(() =>
        payloadInput.addPayloadEnvelope({
          envelope: freshEnvelope,
          source: PayloadEnvelopeInputSource.byRange,
          seenTimestampSec: Date.now() / 1000,
          verified: false,
        })
      ).not.toThrow();

      await waitPromise;
      expect(payloadInput.getPayloadEnvelope()).toBe(freshEnvelope);
      expect(payloadInput.isComplete()).toBe(true);
    });

    it("is a no-op when no envelope is attached or on double removal", () => {
      const {payloadInput, blockRoot} = buildPayloadInput({blobCount: 0, sampledColumns: []});
      expect(payloadInput.removeUnverifiedPayloadEnvelope()).toBeNull();

      payloadInput.addPayloadEnvelope({
        envelope: buildEnvelope(blockRoot),
        source: PayloadEnvelopeInputSource.byRange,
        seenTimestampSec: Date.now() / 1000,
        verified: false,
      });
      expect(payloadInput.removeUnverifiedPayloadEnvelope()).not.toBeNull();
      expect(payloadInput.removeUnverifiedPayloadEnvelope()).toBeNull();
      expect(payloadInput.hasPayloadEnvelope()).toBe(false);
    });
  });

  describe("markPayloadEnvelopeVerified", () => {
    it("is a no-op when no envelope is attached", () => {
      const {payloadInput} = buildPayloadInput({blobCount: 0, sampledColumns: []});
      expect(() => payloadInput.markPayloadEnvelopeVerified()).not.toThrow();
      expect(payloadInput.isPayloadEnvelopeVerified()).toBe(false);
    });
  });
});
