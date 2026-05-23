import {describe, expect, it} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {BroadcastValidation, getDefinitions} from "../../../src/beacon/routes/beacon/block.js";
import {WireFormat} from "../../../src/utils/wireFormat.js";

function lowercaseKeys<T extends Record<string, string>>(headers: T): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

describe("publishExecutionPayloadEnvelope route", () => {
  const config = createChainForkConfig({...defaultChainConfig, GLOAS_FORK_EPOCH: 0});
  const definitions = getDefinitions(config);
  const route = definitions.publishExecutionPayloadEnvelope;

  const signedExecutionPayloadEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();

  describe("JSON wire format", () => {
    it("round-trips a bare SignedExecutionPayloadEnvelope", () => {
      const written = route.req.writeReqJson({signedExecutionPayloadEnvelope});
      expect(written.body).toHaveProperty("message");
      expect(written.body).toHaveProperty("signature");
      expect(written.body).not.toHaveProperty("signed_execution_payload_envelope");

      const parsed = route.req.parseReqJson({
        body: written.body,
        headers: lowercaseKeys(written.headers),
        query: written.query ?? {},
      });
      expect(parsed.signedExecutionPayloadEnvelope).toEqual(signedExecutionPayloadEnvelope);
      expect(parsed.blobs).toBeUndefined();
      expect(parsed.kzgProofs).toBeUndefined();
    });

    it("round-trips a SignedExecutionPayloadEnvelopeContents wrapper when blobs are supplied", () => {
      const blobs = [ssz.deneb.Blob.defaultValue()];
      const kzgProofs = Array.from({length: 128}, () => ssz.deneb.KZGProof.defaultValue());

      const written = route.req.writeReqJson({
        signedExecutionPayloadEnvelope,
        blobs,
        kzgProofs,
        broadcastValidation: BroadcastValidation.consensus,
      });
      expect(written.body).toHaveProperty("signed_execution_payload_envelope");
      expect(written.body).toHaveProperty("kzg_proofs");
      expect(written.body).toHaveProperty("blobs");
      expect(written.query?.broadcast_validation).toBe(BroadcastValidation.consensus);

      const parsed = route.req.parseReqJson({
        body: written.body,
        headers: lowercaseKeys(written.headers),
        query: written.query ?? {},
      });
      expect(parsed.signedExecutionPayloadEnvelope).toEqual(signedExecutionPayloadEnvelope);
      expect(parsed.blobs).toEqual(blobs);
      expect(parsed.kzgProofs).toEqual(kzgProofs);
      expect(parsed.broadcastValidation).toBe(BroadcastValidation.consensus);
    });
  });

  describe("SSZ wire format", () => {
    it("round-trips a bare SignedExecutionPayloadEnvelope", () => {
      const written = route.req.writeReqSsz({signedExecutionPayloadEnvelope});
      const parsed = route.req.parseReqSsz({
        body: written.body,
        headers: lowercaseKeys(written.headers),
        query: written.query ?? {},
      });
      expect(parsed.signedExecutionPayloadEnvelope).toEqual(signedExecutionPayloadEnvelope);
      expect(parsed.blobs).toBeUndefined();
      expect(parsed.kzgProofs).toBeUndefined();
    });

    it("round-trips a SignedExecutionPayloadEnvelopeContents wrapper", () => {
      const blobs = [ssz.deneb.Blob.defaultValue()];
      const kzgProofs = Array.from({length: 128}, () => ssz.deneb.KZGProof.defaultValue());

      const written = route.req.writeReqSsz({signedExecutionPayloadEnvelope, blobs, kzgProofs});
      const parsed = route.req.parseReqSsz({
        body: written.body,
        headers: lowercaseKeys(written.headers),
        query: written.query ?? {},
      });
      expect(parsed.signedExecutionPayloadEnvelope).toEqual(signedExecutionPayloadEnvelope);
      expect(parsed.blobs).toEqual(blobs);
      expect(parsed.kzgProofs).toEqual(kzgProofs);
    });
  });

  it("uses SSZ as the default request wire format", () => {
    expect(route.init?.requestWireFormat).toBe(WireFormat.ssz);
  });
});
