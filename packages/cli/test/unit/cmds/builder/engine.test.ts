import {createHmac} from "node:crypto";
import {createServer} from "node:http";
import {afterEach, describe, expect, it, vi} from "vitest";
import {EnginePayloadSource} from "@lodestar/builder";
import {ForkName, ForkPostGloas} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ErrorAborted, toHex} from "@lodestar/utils";
import {BuilderEngineErrorCode, createPayloadSourceEngine} from "../../../../src/cmds/builder/engine.js";

describe("Builder JSON-RPC Engine connection", () => {
  const jwtSecret = new Uint8Array(32).fill(1);
  const headBlockHash = toHex(new Uint8Array(32).fill(1));
  const safeBlockHash = toHex(new Uint8Array(32).fill(2));
  const finalizedBlockHash = toHex(new Uint8Array(32).fill(3));
  const forkchoiceState = {headBlockHash, safeBlockHash, finalizedBlockHash};
  const payloadId = "0x0102030405060708";
  const validResult = {
    payloadId,
    payloadStatus: {status: "VALID", latestValidHash: headBlockHash, validationError: null},
  };
  const makeEngine = () => createPayloadSourceEngine({url: "http://localhost:8551", jwtSecret});

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(["prepare", "getPayload"] as const)("rejects Heze %s before sending a request", async (operation) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({result: operation === "prepare" ? validResult : payloadResponse()}));
    vi.stubGlobal("fetch", fetch);
    const source = new EnginePayloadSource("local", makeEngine());
    const result =
      operation === "prepare"
        ? prepare(makeEngine(), ForkName.heze)
        : source.getPayload({sourceId: "local", fork: ForkName.heze, payloadId}, new AbortController().signal);

    await expect(result).rejects.toMatchObject({type: {code: BuilderEngineErrorCode.UNSUPPORTED_FORK}});
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends Gloas attributes, explicit null custody and the supplied finality hashes", async () => {
    const fork = ForkName.gloas;
    const attributes = ssz[fork].PayloadAttributes.defaultValue();
    attributes.timestamp = 42;
    attributes.slotNumber = 3;
    attributes.targetGasLimit = 30_000_000n;
    attributes.prevRandao.fill(4);
    attributes.suggestedFeeRecipient = toHex(new Uint8Array(20).fill(5));
    attributes.parentBeaconBlockRoot.fill(6);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({result: validResult}));
    vi.stubGlobal("fetch", fetch);
    const source = new EnginePayloadSource("local", makeEngine());

    await expect(
      source.prepare({fork, forkchoiceState, payloadAttributes: attributes}, new AbortController().signal)
    ).resolves.toEqual({sourceId: "local", fork, payloadId});

    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "engine_forkchoiceUpdatedV4",
      params: [
        forkchoiceState,
        {
          timestamp: "0x2a",
          slotNumber: "0x3",
          targetGasLimit: "0x1c9c380",
          prevRandao: toHex(attributes.prevRandao),
          suggestedFeeRecipient: attributes.suggestedFeeRecipient,
          parentBeaconBlockRoot: toHex(attributes.parentBeaconBlockRoot),
          withdrawals: [],
        },
        null,
      ],
    });
  });

  it("retrieves Gloas payloads with getPayloadV6", async () => {
    const fork = ForkName.gloas;
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({result: payloadResponse()}));
    vi.stubGlobal("fetch", fetch);
    const source = new EnginePayloadSource("local", makeEngine());

    const result = await source.getPayload({sourceId: "local", fork, payloadId}, new AbortController().signal);

    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
      method: "engine_getPayloadV6",
      params: [payloadId],
    });
    expect(result.executionPayload).toEqual(ssz[fork].ExecutionPayload.defaultValue());
    expect(result.executionPayloadValue).toBe(123n);
    expect(result.executionRequests).toEqual(ssz[fork].ExecutionRequests.defaultValue());
    expect(result.blobsBundle).toEqual({blobs: [], commitments: [], proofs: []});
  });

  it.each([
    ssz.heze.PayloadAttributes.defaultValue(),
    {...ssz.heze.PayloadAttributes.defaultValue(), inclusionListTransactions: undefined},
  ])("rejects inclusion-list attributes on the Gloas connection before sending", async (attributes) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(
      makeEngine().notifyForkchoiceUpdate(
        ForkName.gloas,
        headBlockHash,
        safeBlockHash,
        finalizedBlockHash,
        attributes,
        null,
        new AbortController().signal
      )
    ).rejects.toMatchObject({type: {code: BuilderEngineErrorCode.INVALID_ATTRIBUTES}});
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["INVALID", "ACCEPTED"])("rejects %s even if a payload ID is supplied", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          result: {
            payloadId,
            payloadStatus: {status, latestValidHash: null, validationError: "invalid parent"},
          },
        })
      )
    );
    await expect(prepare(makeEngine())).rejects.toMatchObject({
      type: {code: BuilderEngineErrorCode.PAYLOAD_NOT_VALID, status, validationError: "invalid parent"},
    });
  });

  it("leaves a syncing Engine retryable through the missing-payload-ID error", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        result: {
          payloadId: null,
          payloadStatus: {status: "SYNCING", latestValidHash: null, validationError: null},
        },
      })
    );
    vi.stubGlobal("fetch", fetch);
    await expect(prepare(makeEngine())).rejects.toMatchObject({
      type: {code: "PAYLOAD_SOURCE_ERROR_NO_PAYLOAD_ID"},
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("lets PayloadSource reject a missing payload ID", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({result: {...validResult, payloadId: null}})));
    await expect(prepare(makeEngine())).rejects.toMatchObject({type: {code: "PAYLOAD_SOURCE_ERROR_NO_PAYLOAD_ID"}});
  });

  it("rejects an empty hexadecimal payload ID on a VALID response", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({result: {...validResult, payloadId: "0x"}}));
    vi.stubGlobal("fetch", fetch);
    await expect(prepare(makeEngine())).rejects.toMatchObject({
      type: {code: BuilderEngineErrorCode.INVALID_PAYLOAD_ID, payloadId: "0x"},
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["prepare", "getPayload"] as const)("retries a transient transport failure during %s", async (operation) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", {status: 503}))
      .mockResolvedValueOnce(Response.json({result: operation === "prepare" ? validResult : payloadResponse()}));
    vi.stubGlobal("fetch", fetch);
    const engine = makeEngine();
    await (operation === "prepare"
      ? prepare(engine)
      : engine.getPayload(ForkName.gloas, payloadId, new AbortController().signal));
    expect(fetch).toHaveBeenCalledTimes(2);
    const firstRequest = JSON.parse(String(fetch.mock.calls[0][1].body));
    expect(JSON.parse(String(fetch.mock.calls[1][1].body))).toMatchObject({
      method: firstRequest.method,
      params: firstRequest.params,
    });
  });

  it.each([400, 401, 403, 404])("does not retry HTTP %s", async (status) => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response("rejected", {status})));
    vi.stubGlobal("fetch", fetch);
    await expect(prepare(makeEngine())).rejects.toMatchObject({status});
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds transient retries", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response("busy", {status: 429})));
    vi.stubGlobal("fetch", fetch);
    await expect(prepare(makeEngine())).rejects.toMatchObject({status: 429});
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("cancels during transport retry backoff", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response("busy", {status: 503})));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const engine = createPayloadSourceEngine({url: "http://localhost:8551", jwtSecret, signal: controller.signal});
    const result = expect(prepare(engine)).rejects.toThrow(ErrorAborted);
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves an unsupported Engine method error without downgrading or retrying", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({error: {code: -32601, message: "Method not found"}}));
    vi.stubGlobal("fetch", fetch);
    await expect(prepare(makeEngine())).rejects.toMatchObject({
      response: {error: {code: -32601}},
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not send cancelled preparation or retrieval requests", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const source = new EnginePayloadSource("local", makeEngine());
    const signal = AbortSignal.abort();
    await expect(
      source.prepare(
        {
          fork: ForkName.gloas,
          forkchoiceState,
          payloadAttributes: ssz.gloas.PayloadAttributes.defaultValue(),
        },
        signal
      )
    ).rejects.toThrow(ErrorAborted);
    await expect(source.getPayload({sourceId: "local", fork: ForkName.gloas, payloadId}, signal)).rejects.toThrow(
      ErrorAborted
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [[], "0x" + "00".repeat(16)],
    [[0, 7, 8, 127], "0x8101" + "00".repeat(13) + "80"],
  ])("serializes a non-null custody set %s as a bitvector", async (columns, expected) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({result: validResult}));
    vi.stubGlobal("fetch", fetch);
    await makeEngine().notifyForkchoiceUpdate(
      ForkName.gloas,
      headBlockHash,
      safeBlockHash,
      finalizedBlockHash,
      ssz.gloas.PayloadAttributes.defaultValue(),
      columns,
      new AbortController().signal
    );
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).params[2]).toBe(expected);
  });

  it.each([-1, 128, 0.5, NaN])("rejects invalid custody column %s", async (column) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      makeEngine().notifyForkchoiceUpdate(
        ForkName.gloas,
        headBlockHash,
        safeBlockHash,
        finalizedBlockHash,
        ssz.gloas.PayloadAttributes.defaultValue(),
        [column],
        new AbortController().signal
      )
    ).rejects.toMatchObject({type: {code: BuilderEngineErrorCode.INVALID_CUSTODY_COLUMN}});
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a Gloas response missing its block access list", async () => {
    const response = payloadResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          result: {
            ...response,
            executionPayload: {...response.executionPayload, blockAccessList: undefined},
          },
        })
      )
    );
    await expect(makeEngine().getPayload(ForkName.gloas, payloadId, new AbortController().signal)).rejects.toThrow(
      "blockAccessList missing"
    );
  });

  it.each(["blobsBundle", "executionRequests"] as const)(
    "leaves missing %s validation to PayloadSource",
    async (field) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json({result: {...payloadResponse(), [field]: undefined}}))
      );
      const source = new EnginePayloadSource("local", makeEngine());
      await expect(
        source.getPayload({sourceId: "local", fork: ForkName.gloas, payloadId}, new AbortController().signal)
      ).rejects.toMatchObject({
        type: {
          code:
            field === "blobsBundle"
              ? "PAYLOAD_SOURCE_ERROR_MISSING_BLOBS_BUNDLE"
              : "PAYLOAD_SOURCE_ERROR_MISSING_EXECUTION_REQUESTS",
        },
      });
    }
  );

  it("authenticates a real local HTTP request with the existing JWT client", async () => {
    let received: {authorization: string | undefined; body: string} | undefined;
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      received = {authorization: req.headers.authorization, body: Buffer.concat(chunks).toString()};
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({jsonrpc: "2.0", id: 1, result: validResult}));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw Error("Expected TCP server address");
      await prepare(createPayloadSourceEngine({url: `http://127.0.0.1:${address.port}`, jwtSecret}));
      if (!received) throw Error("Engine request not received");
      const {authorization, body} = received;
      expect(JSON.parse(body).method).toBe("engine_forkchoiceUpdatedV4");
      const [header, payload, signature] = (authorization ?? "").replace("Bearer ", "").split(".");
      expect(JSON.parse(Buffer.from(header, "base64url").toString()).alg).toBe("HS256");
      expect(signature).toBe(createHmac("sha256", jwtSecret).update(`${header}.${payload}`).digest("base64url"));
      const claim = JSON.parse(Buffer.from(payload, "base64url").toString());
      expect(Math.abs(claim.iat - Date.now() / 1000)).toBeLessThan(5);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  function prepare(engine: ReturnType<typeof makeEngine>, fork: ForkPostGloas = ForkName.gloas) {
    return new EnginePayloadSource("local", engine).prepare(
      {
        fork,
        forkchoiceState,
        payloadAttributes: ssz[fork].PayloadAttributes.defaultValue(),
      },
      new AbortController().signal
    );
  }
});

function payloadResponse() {
  const zeroHash = "0x" + "00".repeat(32);
  return {
    executionPayload: {
      parentHash: zeroHash,
      feeRecipient: "0x" + "00".repeat(20),
      stateRoot: zeroHash,
      receiptsRoot: zeroHash,
      logsBloom: "0x" + "00".repeat(256),
      prevRandao: zeroHash,
      blockNumber: "0x0",
      gasLimit: "0x0",
      gasUsed: "0x0",
      timestamp: "0x0",
      extraData: "0x",
      baseFeePerGas: "0x0",
      blockHash: zeroHash,
      transactions: [],
      withdrawals: [],
      blobGasUsed: "0x0",
      excessBlobGas: "0x0",
      blockAccessList: "0x",
      slotNumber: "0x0",
    },
    blockValue: "0x7b",
    executionRequests: [],
    blobsBundle: {blobs: [], commitments: [], proofs: []},
  };
}
