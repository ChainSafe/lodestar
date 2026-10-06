import {beforeEach, describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ClientCode} from "../../../src/execution/engine/interface.js";
import {EngineRestHttpClient} from "../../../src/execution/engine/restHttpClient.js";
import {RestEngineTransport} from "../../../src/execution/engine/restTransport.js";

describe("REST engine metadata and limits", () => {
  const client = new EngineRestHttpClient(["http://127.0.0.1:8551"]);
  const request = vi.spyOn(client, "request");
  const probe = vi.spyOn(client, "requestWithRetries");
  let transport: RestEngineTransport;
  const hash = new Uint8Array(32);
  const hashHex = `0x${"00".repeat(32)}`;
  const capabilities = {
    supported_forks: ["paris", "future-fork"],
    independently_versioned: {blobs: ["v1", "v2"]},
  };
  const identity = {code: ClientCode.XX, name: "Test EL", version: "1", commit: "12345678"};

  function jsonResponse(value: unknown) {
    return {status: 200, body: new TextEncoder().encode(JSON.stringify(value))};
  }

  beforeEach(() => {
    request.mockReset().mockResolvedValue({status: 204, body: new Uint8Array()});
    probe.mockReset().mockResolvedValue(jsonResponse(capabilities));
    transport = new RestEngineTransport(client);
  });

  it("uses spec limits when the EL omits optional limits", async () => {
    expect(await transport.getCapabilities()).toMatchObject({
      supportedForks: new Set(["paris", "future-fork"]),
      blobsRevisions: new Set(["v1", "v2"]),
      limits: {bodiesMaxCount: 32, blobsMaxVersionedHashes: 128, payloadMaxBytes: 67108864},
    });
  });

  it.each([null, [], {}, {supported_forks: [1]}, {...capabilities, independently_versioned: {blobs: "v1"}}])(
    "rejects malformed capabilities: %j",
    async (body) => {
      probe.mockResolvedValue(jsonResponse(body));
      await expect(transport.getCapabilities()).rejects.toMatchObject({type: {code: "ENGINE_REST_INVALID_RESPONSE"}});
    }
  );

  it.each([0, -1, 1.5, "1"])("rejects invalid advertised limits: %j", async (limit) => {
    probe.mockResolvedValue(jsonResponse({...capabilities, limits: {"bodies.max_count": limit}}));
    await expect(transport.getCapabilities()).rejects.toMatchObject({type: {code: "ENGINE_REST_INVALID_RESPONSE"}});
  });

  it("caps advertised limits at the spec bounds", async () => {
    probe.mockResolvedValue(
      jsonResponse({...capabilities, limits: {"bodies.max_count": 100, "blobs.max_versioned_hashes": 1000}})
    );
    expect(await transport.getCapabilities()).toMatchObject({
      limits: {bodiesMaxCount: 32, blobsMaxVersionedHashes: 128},
    });
  });

  it("rejects oversized body and blob requests before making an HTTP request", async () => {
    probe.mockResolvedValue(
      jsonResponse({...capabilities, limits: {"bodies.max_count": 1, "blobs.max_versioned_hashes": 1}})
    );
    await transport.getCapabilities();
    await expect(transport.getPayloadBodiesByHashV2([hashHex, hashHex])).rejects.toThrow();
    await expect(transport.getBlobsV1([hash, hash])).rejects.toThrow();
    await expect(transport.getBlobsV2([hash, hash])).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("enforces the advertised payload byte limit", async () => {
    probe.mockResolvedValue(jsonResponse({...capabilities, limits: {"payload.max_bytes": 1}}));
    await transport.getCapabilities();
    await expect(
      transport.newPayload(ForkName.bellatrix, ssz.bellatrix.ExecutionPayload.defaultValue())
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([null, {}, [null], [{code: "XX"}], [{...identity, name: 1}]])(
    "rejects malformed identity: %j",
    async (body) => {
      request.mockResolvedValue(jsonResponse(body));
      await expect(transport.getClientVersion(identity)).rejects.toMatchObject({
        type: {code: "ENGINE_REST_INVALID_RESPONSE"},
      });
    }
  );

  it("normalizes a valid identity and preserves unknown client names", async () => {
    request.mockResolvedValue(jsonResponse([{...identity, code: "NEW", commit: "0x12345678"}]));
    expect(await transport.getClientVersion(identity)).toEqual([identity]);
  });
});
