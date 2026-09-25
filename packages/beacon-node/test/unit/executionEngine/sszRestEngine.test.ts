import {FastifyInstance, FastifyReply, fastify} from "fastify";
import {afterEach, describe, expect, it, vi} from "vitest";
import {ByteListType, ByteVectorType, ContainerType, ListCompositeType, UintNumberType} from "@chainsafe/ssz";
import {Logger} from "@lodestar/logger";
import {ForkName, MAX_BYTES_PER_TRANSACTION} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ExecutionPayloadStatus} from "../../../src/execution/engine/interface.js";
import {
  JsonRpcHttpClientEvent,
  JsonRpcHttpClientEventEmitter,
} from "../../../src/execution/engine/jsonRpcHttpClient.js";
import {SszRestClient} from "../../../src/execution/engine/sszRestClient.js";
import {SszRestEngine} from "../../../src/execution/engine/sszRestEngine.js";

type FakeEl = {server: FastifyInstance; url: string};

// fastify 5 rejects routes registered after `listen()`, so `setup` must register every
// route the test needs before the server starts listening.
async function startFakeEl(
  afterCallbacks: (() => Promise<void>)[],
  setup: (server: FastifyInstance) => void
): Promise<FakeEl> {
  const server = fastify({logger: false});
  server.addContentTypeParser("application/octet-stream", {parseAs: "buffer"}, (_req, body, done) => done(null, body));
  setup(server);
  const url = await server.listen({host: "127.0.0.1", port: 0});
  afterCallbacks.push(async () => server.close());
  return {server, url};
}

function makeLogger(): Logger & {calls: {level: string; msg: string}[]} {
  const calls: {level: string; msg: string}[] = [];
  const mk = (level: string) => (msg: string) => calls.push({level, msg});
  return {
    calls,
    debug: mk("debug"),
    info: mk("info"),
    warn: mk("warn"),
    error: mk("error"),
    verbose: mk("verbose"),
  } as never;
}

function makeEngine(url: string): {
  engine: SszRestEngine;
  logger: ReturnType<typeof makeLogger>;
  emitter: JsonRpcHttpClientEventEmitter;
} {
  const logger = makeLogger();
  const emitter = new JsonRpcHttpClientEventEmitter();
  const client = new SszRestClient({baseUrl: url, clientVersionHeader: "LS/vtest", timeout: 500});
  return {engine: new SszRestEngine(client, {logger, emitter}), logger, emitter};
}

describe("SszRestEngine / negotiation", () => {
  const afterCallbacks: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (afterCallbacks.length) await afterCallbacks.pop()?.();
  });

  it("probes /engine/v1/capabilities once and gates by supported_forks", async () => {
    let probes = 0;
    const {url} = await startFakeEl(afterCallbacks, (server) => {
      server.get("/engine/v1/capabilities", async () => {
        probes++;
        return {
          supported_forks: ["cancun", "prague"],
          independently_versioned: {blobs: ["v1"]},
          limits: {"bodies.max_count": 16},
        };
      });
    });
    const {engine} = makeEngine(url);

    expect(await engine.isAvailable()).toBe(true);
    expect(await engine.supportsFork(ForkName.deneb)).toBe(true);
    expect(await engine.supportsFork(ForkName.electra)).toBe(true);
    expect(await engine.supportsFork(ForkName.fulu)).toBe(false);
    expect(await engine.supportsFork(ForkName.bellatrix)).toBe(false);
    expect(await engine.supportsBlobs(1)).toBe(true);
    expect(await engine.supportsBlobs(2)).toBe(false);
    expect((await engine.limits()).bodiesMaxCount).toBe(16);
    expect(probes).toBe(1);
  });

  it("disables REST for the lifetime on 404 and logs once at info", async () => {
    const {url} = await startFakeEl(afterCallbacks, (server) => {
      server.get("/engine/v1/capabilities", async (_req, reply) => reply.code(404).send("legacy"));
    });
    const {engine, logger} = makeEngine(url);

    expect(await engine.isAvailable()).toBe(false);
    expect(await engine.supportsFork(ForkName.deneb)).toBe(false);
    expect(await engine.supportsBlobs(1)).toBe(false);
    expect((await engine.limits()).bodiesMaxCount).toBe(32);
    expect(logger.calls.filter((c) => c.level === "info" && /not available/.test(c.msg)).length).toBe(1);
  });

  it("disables REST on connection failure and on a malformed capabilities body", async () => {
    const {engine: down} = makeEngine("http://127.0.0.1:1");
    expect(await down.isAvailable()).toBe(false);

    const {url} = await startFakeEl(afterCallbacks, (server) => {
      server.get("/engine/v1/capabilities", async () => ({hello: "world"}));
    });
    const {engine: malformed} = makeEngine(url);
    expect(await malformed.isAvailable()).toBe(false);
  });

  it("identity returns ClientVersion[] and emits RESPONSE", async () => {
    const {url} = await startFakeEl(afterCallbacks, (server) => {
      server.get("/engine/v1/capabilities", async () => ({supported_forks: []}));
      server.get("/engine/v1/identity", async () => [{code: "GE", name: "geth", version: "1", commit: "0x01020304"}]);
    });
    const {engine, emitter} = makeEngine(url);
    const onResponse = vi.fn();
    emitter.on(JsonRpcHttpClientEvent.RESPONSE, onResponse);

    expect(await engine.identity()).toEqual([{code: "GE", name: "geth", version: "1", commit: "0x01020304"}]);
    expect(onResponse).toHaveBeenCalledTimes(1);
  });

  it("identity rejects without an HTTP request when REST is unavailable", async () => {
    let identityRequests = 0;
    const {url} = await startFakeEl(afterCallbacks, (server) => {
      server.get("/engine/v1/capabilities", async (_req, reply) => reply.code(404).send("legacy"));
      server.get("/engine/v1/identity", async () => {
        identityRequests++;
        return [];
      });
    });
    const {engine} = makeEngine(url);

    await expect(engine.identity()).rejects.toThrow(/not available/);
    expect(identityRequests).toBe(0);
  });

  it("emits ERROR and rethrows on a failed request", async () => {
    const {url} = await startFakeEl(afterCallbacks, (server) => {
      server.get("/engine/v1/capabilities", async () => ({supported_forks: []}));
      server.get("/engine/v1/identity", async (_req, reply) =>
        reply.code(500).send({type: "/engine-api/errors/internal"})
      );
    });
    const {engine, emitter} = makeEngine(url);
    const onError = vi.fn();
    emitter.on(JsonRpcHttpClientEvent.ERROR, onError);

    await expect(engine.identity()).rejects.toThrow(/internal/);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

// Spec oracle containers for the fake EL's responses.
const U8 = new UintNumberType(1);
const R32 = new ByteVectorType(32);
const OptR32 = new ListCompositeType(R32, 1);
const OptStr = new ListCompositeType(new ByteListType(1024), 1);
const OptId = new ListCompositeType(new ByteVectorType(8), 1);
const PayloadStatusT = new ContainerType({status: U8, latestValidHash: OptR32, validationError: OptStr});
const FcuRespT = new ContainerType({payloadStatus: PayloadStatusT, payloadId: OptId});
const ReqListT = new ListCompositeType(new ByteListType(MAX_BYTES_PER_TRANSACTION), 256);
const BuiltOsakaT = new ContainerType({
  payload: ssz.deneb.ExecutionPayload,
  blockValue: ssz.UintBn256,
  blobsBundle: ssz.fulu.BlobsBundle,
  executionRequests: ReqListT,
  shouldOverrideBuilder: ssz.Boolean,
});
const sendSsz = (reply: FastifyReply, data: Uint8Array): void => {
  reply.header("Content-Type", "application/octet-stream");
  reply.send(Buffer.from(data));
};
const zero32 = new Uint8Array(32);
const zeroHex = `0x${"00".repeat(32)}`;

describe("SszRestEngine / hot path", () => {
  const afterCallbacks: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (afterCallbacks.length) await afterCallbacks.pop()?.();
  });

  async function elWithForks(forks: string[], setup: (server: FastifyInstance) => void): Promise<FakeEl> {
    return startFakeEl(afterCallbacks, (server) => {
      server.get("/engine/v1/capabilities", async () => ({supported_forks: forks}));
      setup(server);
    });
  }

  it("newPayload posts the envelope with the fork header and decodes PayloadStatus", async () => {
    let forkHeader: string | undefined;
    let bodyLen = 0;
    const {url} = await elWithForks(["cancun"], (server) => {
      server.post("/engine/v1/payloads", async (req, reply) => {
        forkHeader = req.headers["eth-execution-version"] as string;
        bodyLen = (req.body as Buffer).length;
        sendSsz(
          reply,
          PayloadStatusT.serialize({
            status: 1,
            latestValidHash: [zero32],
            validationError: [new TextEncoder().encode("boom")],
          })
        );
      });
    });
    const {engine} = makeEngine(url);

    const res = await engine.newPayload(ForkName.deneb, ssz.deneb.ExecutionPayload.defaultValue(), zero32);

    expect(forkHeader).toBe("cancun");
    expect(bodyLen).toBeGreaterThan(0);
    expect(res).toEqual({status: ExecutionPayloadStatus.INVALID, latestValidHash: zeroHex, validationError: "boom"});
  });

  it("forkchoiceUpdated returns payload_id as hex DATA", async () => {
    const {url} = await elWithForks(["prague"], (server) => {
      server.post("/engine/v1/forkchoice", async (req, reply) => {
        expect(req.headers["eth-execution-version"]).toBe("prague");
        sendSsz(
          reply,
          FcuRespT.serialize({
            payloadStatus: {status: 0, latestValidHash: [zero32], validationError: []},
            payloadId: [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])],
          })
        );
      });
    });
    const {engine} = makeEngine(url);

    const res = await engine.forkchoiceUpdated(ForkName.electra, zeroHex, zeroHex, zeroHex, {
      timestamp: 1,
      prevRandao: zero32,
      suggestedFeeRecipient: `0x${"22".repeat(20)}`,
      withdrawals: [],
      parentBeaconBlockRoot: zero32,
    });

    expect(res.payloadStatus.status).toBe(ExecutionPayloadStatus.VALID);
    expect(res.payloadId).toBe("0x0102030405060708");
  });

  it("getPayload GETs /payloads/{id} with the fork header and decodes BuiltPayload", async () => {
    let seenUrl = "";
    const {url} = await elWithForks(["osaka"], (server) => {
      server.get("/engine/v1/payloads/:id", async (req, reply) => {
        seenUrl = req.url;
        expect(req.headers["eth-execution-version"]).toBe("osaka");
        const payload = ssz.deneb.ExecutionPayload.defaultValue();
        payload.blockNumber = 11;
        sendSsz(
          reply,
          BuiltOsakaT.serialize({
            payload,
            blockValue: 99n,
            blobsBundle: ssz.fulu.BlobsBundle.defaultValue(),
            executionRequests: [],
            shouldOverrideBuilder: true,
          })
        );
      });
    });
    const {engine} = makeEngine(url);

    const res = await engine.getPayload(ForkName.fulu, "0x0102030405060708");

    expect(seenUrl).toBe("/engine/v1/payloads/0x0102030405060708");
    expect(res.executionPayload.blockNumber).toBe(11);
    expect(res.blockValue).toBe(99n);
    expect(res.shouldOverrideBuilder).toBe(true);
    expect(res.executionRequests).toEqual({deposits: [], withdrawals: [], consolidations: []});
  });

  it("a 204 on a hot-path endpoint is an error", async () => {
    const {url} = await elWithForks(["cancun"], (server) => {
      server.get("/engine/v1/payloads/:id", async (_req, reply) => reply.code(204).send());
    });
    const {engine} = makeEngine(url);
    await expect(engine.getPayload(ForkName.deneb, "0x0102030405060708")).rejects.toThrow(/unexpected empty response/);
  });

  it("getPayload rejects a malformed payloadId before making a request", async () => {
    let hits = 0;
    const {url} = await elWithForks(["cancun"], (server) => {
      server.get("/engine/v1/payloads/*", async (_req, reply) => {
        hits++;
        reply.code(204).send();
      });
    });
    const {engine} = makeEngine(url);

    await expect(engine.getPayload(ForkName.deneb, "0x12/../etc")).rejects.toThrow(/Invalid payloadId/);
    expect(hits).toBe(0);
  });
});

// Spec oracle containers for /bodies and /blobs/vN — mirrors the fake EL's responses.
const TxListT = new ListCompositeType(new ByteListType(MAX_BYTES_PER_TRANSACTION), 1_048_576);
const BodyShanghaiT = new ContainerType({transactions: TxListT, withdrawals: ssz.capella.Withdrawals});
const BodiesShanghaiT = new ContainerType({
  entries: new ListCompositeType(new ContainerType({available: ssz.Boolean, body: BodyShanghaiT}), 32),
});
const BlobT = new ByteVectorType(131072);
const B48 = new ByteVectorType(48);
const BlobsV1T = new ContainerType({
  entries: new ListCompositeType(
    new ContainerType({available: ssz.Boolean, contents: new ContainerType({blob: BlobT, proof: B48})}),
    128
  ),
});
const BlobsV2T = new ContainerType({
  entries: new ListCompositeType(
    new ContainerType({
      available: ssz.Boolean,
      contents: new ContainerType({blob: BlobT, proofs: new ListCompositeType(B48, 128)}),
    }),
    128
  ),
});

describe("SszRestEngine / bodies & blobs", () => {
  const afterCallbacks: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (afterCallbacks.length) await afterCallbacks.pop()?.();
  });

  async function el(setup: (server: FastifyInstance) => void): Promise<FakeEl> {
    return startFakeEl(afterCallbacks, (server) => {
      server.get("/engine/v1/capabilities", async () => ({
        supported_forks: ["cancun"],
        independently_versioned: {blobs: ["v1", "v2"]},
      }));
      setup(server);
    });
  }

  it("bodiesByHash POSTs /bodies/hash with fork header; available=false -> null", async () => {
    const {url} = await el((server) => {
      server.post("/engine/v1/bodies/hash", async (req, reply) => {
        expect(req.headers["eth-execution-version"]).toBe("cancun");
        sendSsz(
          reply,
          BodiesShanghaiT.serialize({
            entries: [
              {available: false, body: {transactions: [], withdrawals: []}},
              {available: true, body: {transactions: [new Uint8Array([1])], withdrawals: []}},
            ],
          })
        );
      });
    });
    const {engine} = makeEngine(url);
    const out = await engine.bodiesByHash(ForkName.deneb, [zeroHex, zeroHex]);
    expect(out[0]).toBeNull();
    expect(out[1]).toEqual({transactions: [new Uint8Array([1])], withdrawals: []});
  });

  it("bodiesByRange GETs /bodies?from&count with no body; truncated response returned as-is", async () => {
    let query: unknown;
    let contentType: unknown;
    let forkHeader: unknown;
    const {url} = await el((server) => {
      server.get("/engine/v1/bodies", async (req, reply) => {
        query = req.query;
        contentType = req.headers["content-type"];
        forkHeader = req.headers["eth-execution-version"];
        sendSsz(
          reply,
          BodiesShanghaiT.serialize({entries: [{available: true, body: {transactions: [], withdrawals: []}}]})
        );
      });
    });
    const {engine} = makeEngine(url);
    const out = await engine.bodiesByRange(ForkName.deneb, 100, 5);
    expect(query).toEqual({from: "100", count: "5"});
    expect(contentType).toBeUndefined();
    expect(forkHeader).toBe("cancun");
    expect(out.length).toBe(1);
  });

  it("bodiesByRange rejects invalid start/count without making an HTTP request", async () => {
    let requests = 0;
    const {url} = await el((server) => {
      server.get("/engine/v1/bodies", async (_req, reply) => {
        requests++;
        sendSsz(reply, BodiesShanghaiT.serialize({entries: []}));
      });
    });
    const {engine} = makeEngine(url);
    await expect(engine.bodiesByRange(ForkName.deneb, 1.5, 2)).rejects.toThrow(/Invalid bodies range/);
    await expect(engine.bodiesByRange(ForkName.deneb, 1, -1)).rejects.toThrow(/Invalid bodies range/);
    expect(requests).toBe(0);
  });

  it("blobsV1: no fork header; partial -> null; 204 -> all null", async () => {
    let mode: "partial" | "empty" = "partial";
    const {url} = await el((server) => {
      server.post("/engine/v1/blobs/v1", async (req, reply) => {
        expect(req.headers["eth-execution-version"]).toBeUndefined();
        if (mode === "empty") return reply.code(204).send();
        sendSsz(
          reply,
          BlobsV1T.serialize({
            entries: [
              {available: true, contents: {blob: new Uint8Array(131072), proof: new Uint8Array(48)}},
              {available: false, contents: {blob: new Uint8Array(131072), proof: new Uint8Array(48)}},
            ],
          })
        );
      });
    });
    const {engine} = makeEngine(url);
    const partial = await engine.blobsV1([zero32, zero32]);
    expect(partial[0]).not.toBeNull();
    expect(partial[1]).toBeNull();
    mode = "empty";
    expect(await engine.blobsV1([zero32, zero32])).toEqual([null, null]);
  });

  it("blobsV2: 204 -> null; 200 -> contents; length mismatch throws", async () => {
    let mode: "ok" | "empty" | "short" = "ok";
    const entry = {
      available: true,
      contents: {blob: new Uint8Array(131072), proofs: Array.from({length: 128}, () => new Uint8Array(48))},
    };
    const {url} = await el((server) => {
      server.post("/engine/v1/blobs/v2", async (_req, reply) => {
        if (mode === "empty") return reply.code(204).send();
        sendSsz(reply, BlobsV2T.serialize({entries: mode === "short" ? [entry] : [entry, entry]}));
      });
    });
    const {engine} = makeEngine(url);
    expect((await engine.blobsV2([zero32, zero32]))?.length).toBe(2);
    mode = "empty";
    expect(await engine.blobsV2([zero32, zero32])).toBeNull();
    mode = "short";
    await expect(engine.blobsV2([zero32, zero32])).rejects.toThrow(/length/);
  });

  it("blobsRevision picks v1 before fulu and v2 from fulu", () => {
    expect(SszRestEngine.blobsRevision(ForkName.deneb)).toBe(1);
    expect(SszRestEngine.blobsRevision(ForkName.electra)).toBe(1);
    expect(SszRestEngine.blobsRevision(ForkName.fulu)).toBe(2);
    expect(SszRestEngine.blobsRevision(ForkName.gloas)).toBe(2);
  });

  it("blobsRevision is null for forks with no EL fork mapping", () => {
    // heze has no Eth-Execution-Version value yet; pre-merge forks have no Engine API.
    expect(SszRestEngine.blobsRevision(ForkName.heze)).toBeNull();
    expect(SszRestEngine.blobsRevision(ForkName.phase0)).toBeNull();
  });
});
