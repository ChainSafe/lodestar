import {FastifyReply, FastifyRequest, fastify} from "fastify";
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {Logger} from "@lodestar/logger";
import {ForkName, ForkSeq} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {fromHex, toHex} from "@lodestar/utils";
import {EngineApiMode} from "../../../src/execution/engine/http.js";
import {PayloadAttributes} from "../../../src/execution/engine/interface.js";
import {decodeJwtToken} from "../../../src/execution/engine/jwt.js";
import {
  BlobsRequest,
  BlobsV1Response,
  BlobsV2Response,
  BodiesByHashRequest,
  BodiesResponseCapella,
  BodiesResponseGloas,
  BuiltPayloadFulu,
  ForkchoiceUpdateBellatrix,
  ForkchoiceUpdateDeneb,
  ForkchoiceUpdateResponse,
  PayloadStatus,
  PayloadStatusCode,
  engineSszTypes,
  executionForkName,
} from "../../../src/execution/engine/sszTypes.js";
import {BLOB_AND_PROOF_V2_RPC_BYTES, serializeExecutionRequestsToBytes} from "../../../src/execution/engine/types.js";
import {numToQuantity} from "../../../src/execution/engine/utils.js";
import {IExecutionEngine, initializeExecutionEngine} from "../../../src/execution/index.js";

type RecordedRequest = {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

const jwtSecretHex = "0xdc6457099f127cf0bac78de8b297df04951281909db4f58b43def7c7151e765d";
const hashHex = "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174";
const hash = fromHex(hashHex);
const payloadIdHex = "0x0000000000000001";

const defaultCapabilities = {
  supported_forks: ["paris", "shanghai", "cancun", "prague", "osaka", "amsterdam"],
  fork_scoped_endpoints: ["payloads", "forkchoice", "bodies"],
  independently_versioned: {blobs: ["v1", "v2", "v3", "v4"]},
  unscoped_endpoints: ["capabilities", "identity"],
  limits: {"bodies.max_count": 32, "blobs.max_versioned_hashes": 128, "payload.max_bytes": 67108864},
};

const validStatus = {status: PayloadStatusCode.VALID, latestValidHash: [hash], validationError: []};

describe("ExecutionEngine / rest", () => {
  const controller = new AbortController();
  const server = fastify({logger: false});
  let baseUrl: string;

  let requests: RecordedRequest[] = [];
  let capabilities: {status: number; body: unknown} = {status: 200, body: defaultCapabilities};
  let sszResponse: {status: number; body: Uint8Array} = {status: 200, body: new Uint8Array()};
  let problem: {status: number; body: unknown} | null = null;
  let jsonRpcResult: unknown = null;

  function record(req: FastifyRequest): void {
    const body = req.body instanceof Buffer ? new Uint8Array(req.body) : req.body;
    requests.push({method: req.method, url: req.url, headers: req.headers, body});
  }

  function sendSsz(req: FastifyRequest, reply: FastifyReply): FastifyReply {
    record(req);
    if (problem) {
      return reply.code(problem.status).type("application/problem+json").send(problem.body);
    }
    if (sszResponse.status === 204) {
      return reply.code(204).send();
    }
    return reply.type("application/octet-stream").send(Buffer.from(sszResponse.body));
  }

  beforeAll(async () => {
    server.addContentTypeParser("application/octet-stream", {parseAs: "buffer"}, (_req, body, done) => {
      done(null, body);
    });

    server.get("/engine/v1/capabilities", async (req, reply) => {
      record(req);
      return reply.code(capabilities.status).send(capabilities.body);
    });
    server.get("/engine/v1/identity", async (req) => {
      record(req);
      return [{code: "NM", name: "Nethermind", version: "1.0.0", commit: "0x12345678"}];
    });
    server.post("/engine/v1/payloads", async (req, reply) => sendSsz(req, reply));
    server.post("/engine/v1/forkchoice", async (req, reply) => sendSsz(req, reply));
    server.get("/engine/v1/payloads/:payloadId", async (req, reply) => sendSsz(req, reply));
    server.post("/engine/v1/bodies/hash", async (req, reply) => sendSsz(req, reply));
    server.get("/engine/v1/bodies", async (req, reply) => sendSsz(req, reply));
    server.post("/engine/v1/blobs/v1", async (req, reply) => sendSsz(req, reply));
    server.post("/engine/v1/blobs/v2", async (req, reply) => sendSsz(req, reply));
    server.post<{Body: {method: string}}>("/", async (req) => {
      if (req.body.method === "engine_getClientVersionV1") {
        return {jsonrpc: "2.0", id: 1, result: [{code: "XX", name: "Test EL", version: "1", commit: "0x12345678"}]};
      }
      record(req);
      return {jsonrpc: "2.0", id: 1, result: jsonRpcResult};
    });

    baseUrl = await server.listen({port: 0});
  });

  afterAll(async () => {
    controller.abort();
    await server.close();
  });

  beforeEach(() => {
    requests = [];
    capabilities = {status: 200, body: defaultCapabilities};
    sszResponse = {status: 200, body: new Uint8Array()};
    problem = null;
    jsonRpcResult = null;
  });

  function createEngine(engineApi?: EngineApiMode): IExecutionEngine {
    return initializeExecutionEngine(
      {mode: "http", urls: [baseUrl], retries: 1, retryDelay: 10, jwtSecretHex, engineApi},
      {signal: controller.signal, logger: console as unknown as Logger}
    );
  }

  function lastRequest(url: string): RecordedRequest {
    const req = requests.filter((r) => r.url === url).at(-1);
    if (!req) throw Error(`No request recorded for ${url}`);
    return req;
  }

  function jsonRpcMethods(): string[] {
    return requests.filter((r) => r.url === "/").map((r) => (r.body as {method: string}).method);
  }

  describe("transport selection", () => {
    it("uses REST when the execution client advertises it", async () => {
      const engine = createEngine();
      sszResponse.body = ForkchoiceUpdateResponse.serialize({payloadStatus: validStatus, payloadId: []});

      const payloadId = await engine.notifyForkchoiceUpdate(ForkName.bellatrix, hashHex, hashHex, hashHex);

      expect(payloadId).toBeNull();
      expect(lastRequest("/engine/v1/capabilities").method).toBe("GET");
      expect(jsonRpcMethods()).toEqual([]);

      const fcu = lastRequest("/engine/v1/forkchoice");
      expect(fcu.headers["eth-execution-version"]).toBe("paris");
      expect(fcu.headers["content-type"]).toBe("application/octet-stream");
      expect(fcu.headers.accept).toBe("application/octet-stream");
      expect(JSON.parse(fcu.headers["x-engine-client-version"] as string)).toMatchObject({
        code: "LS",
        name: "Lodestar",
      });

      const token = (fcu.headers.authorization as string).replace("Bearer ", "");
      const claim = decodeJwtToken(token, fromHex(jwtSecretHex));
      expect(typeof claim.iat).toBe("number");
      expect(claim.clv).toBeUndefined();

      expect(ForkchoiceUpdateBellatrix.deserialize(fcu.body as Uint8Array)).toEqual({
        forkchoiceState: {headBlockHash: hash, safeBlockHash: hash, finalizedBlockHash: hash},
        payloadAttributes: [],
      });
    });

    it("falls back to JSON-RPC when the REST API is not served", async () => {
      capabilities = {status: 404, body: {message: "Route GET:/engine/v1/capabilities not found"}};
      jsonRpcResult = {payloadStatus: {status: "VALID", latestValidHash: null, validationError: null}, payloadId: null};
      const engine = createEngine();

      await engine.notifyForkchoiceUpdate(ForkName.bellatrix, hashHex, hashHex, hashHex);

      expect(jsonRpcMethods()).toContain("engine_forkchoiceUpdatedV1");
      expect(requests.some((r) => r.url === "/engine/v1/forkchoice")).toBe(false);
    });

    it("falls back to JSON-RPC for forks the execution client does not advertise", async () => {
      capabilities = {status: 200, body: {...defaultCapabilities, supported_forks: ["paris", "shanghai"]}};
      jsonRpcResult = {payloadStatus: {status: "VALID", latestValidHash: null, validationError: null}, payloadId: null};
      const engine = createEngine();

      await engine.notifyForkchoiceUpdate(ForkName.deneb, hashHex, hashHex, hashHex);

      expect(jsonRpcMethods()).toContain("engine_forkchoiceUpdatedV3");
      expect(requests.some((r) => r.url === "/engine/v1/forkchoice")).toBe(false);
    });

    it("falls back to JSON-RPC for blob revisions the execution client does not serve", async () => {
      capabilities = {status: 200, body: {...defaultCapabilities, independently_versioned: {blobs: ["v1"]}}};
      const engine = createEngine();

      expect(await engine.getBlobs(ForkName.fulu, [hash])).toBeNull();

      expect(jsonRpcMethods()).toContain("engine_getBlobsV2");
    });

    it("falls back to JSON-RPC for a fork the execution client rejects despite advertising it", async () => {
      jsonRpcResult = {payloadStatus: {status: "VALID", latestValidHash: null, validationError: null}, payloadId: null};
      const engine = createEngine();
      problem = {status: 400, body: {type: "/engine-api/errors/unsupported-fork", detail: "fork mismatch"}};

      await engine.notifyForkchoiceUpdate(ForkName.deneb, hashHex, hashHex, hashHex);

      expect(requests.filter((r) => r.url === "/engine/v1/forkchoice").length).toBe(1);
      expect(jsonRpcMethods()).toEqual(["engine_forkchoiceUpdatedV3"]);

      // The fork stays on JSON-RPC even once the execution client would accept it
      problem = null;
      await engine.notifyForkchoiceUpdate(ForkName.deneb, hashHex, hashHex, hashHex);

      expect(requests.filter((r) => r.url === "/engine/v1/forkchoice").length).toBe(1);
      expect(jsonRpcMethods()).toEqual(["engine_forkchoiceUpdatedV3", "engine_forkchoiceUpdatedV3"]);
    });

    it("never probes with engineApi=json-rpc", async () => {
      jsonRpcResult = {payloadStatus: {status: "VALID", latestValidHash: null, validationError: null}, payloadId: null};
      const engine = createEngine("json-rpc");

      await engine.notifyForkchoiceUpdate(ForkName.bellatrix, hashHex, hashHex, hashHex);

      expect(requests.some((r) => r.url === "/engine/v1/capabilities")).toBe(false);
      expect(jsonRpcMethods()).toContain("engine_forkchoiceUpdatedV1");
    });

    it("always uses REST with engineApi=ssz", async () => {
      sszResponse.body = ForkchoiceUpdateResponse.serialize({payloadStatus: validStatus, payloadId: []});
      const engine = createEngine("ssz");

      await engine.notifyForkchoiceUpdate(ForkName.bellatrix, hashHex, hashHex, hashHex);

      expect(requests.some((r) => r.url === "/engine/v1/capabilities")).toBe(true);
      expect(jsonRpcMethods()).toEqual([]);
      expect(lastRequest("/engine/v1/forkchoice").headers["eth-execution-version"]).toBe("paris");
    });
  });

  describe("notifyNewPayload", () => {
    for (const fork of [
      ForkName.bellatrix,
      ForkName.capella,
      ForkName.deneb,
      ForkName.electra,
      ForkName.fulu,
      ForkName.gloas,
    ] as const) {
      it(`sends the ${fork} envelope`, async () => {
        const engine = createEngine();
        sszResponse.body = PayloadStatus.serialize(validStatus);

        const payload = ssz[fork].ExecutionPayload.defaultValue();
        payload.blockNumber = 42;
        payload.blockHash = hash;
        payload.transactions = [new Uint8Array([0x02, 0xaa])];
        const executionRequests =
          ForkSeq[fork] >= ForkSeq.gloas
            ? ssz.gloas.ExecutionRequests.defaultValue()
            : ssz.electra.ExecutionRequests.defaultValue();
        executionRequests.deposits = [ssz.electra.DepositRequest.defaultValue()];

        const res = await engine.notifyNewPayload(fork, payload, [], hash, executionRequests);

        expect(res).toEqual({status: "VALID", latestValidHash: hashHex, validationError: null});

        const req = lastRequest("/engine/v1/payloads");
        expect(req.headers["eth-execution-version"]).toBe(executionForkName[fork]);
        const envelope = engineSszTypes[fork].ExecutionPayloadEnvelope.deserialize(req.body as Uint8Array) as {
          payload: unknown;
          parentBeaconBlockRoot?: Uint8Array;
          executionRequests?: Uint8Array[];
        };
        expect(envelope.payload).toEqual(payload);
        if (ForkSeq[fork] >= ForkSeq.deneb) {
          expect(envelope.parentBeaconBlockRoot).toEqual(hash);
        } else {
          expect(envelope.parentBeaconBlockRoot).toBeUndefined();
        }
        if (ForkSeq[fork] >= ForkSeq.electra) {
          expect(envelope.executionRequests).toEqual(serializeExecutionRequestsToBytes(fork, executionRequests));
        } else {
          expect(envelope.executionRequests).toBeUndefined();
        }
      });
    }

    it("returns the validation error of an INVALID payload", async () => {
      const engine = createEngine();
      sszResponse.body = PayloadStatus.serialize({
        status: PayloadStatusCode.INVALID,
        latestValidHash: [],
        validationError: [new TextEncoder().encode("bad state root")],
      });

      const res = await engine.notifyNewPayload(ForkName.bellatrix, ssz.bellatrix.ExecutionPayload.defaultValue());

      expect(res).toEqual({status: "INVALID", latestValidHash: null, validationError: "bad state root"});
    });

    it("reports engine errors as ELERROR", async () => {
      const engine = createEngine();
      problem = {status: 500, body: {type: "/engine-api/errors/internal", detail: "boom"}};

      const res = await engine.notifyNewPayload(ForkName.bellatrix, ssz.bellatrix.ExecutionPayload.defaultValue());

      expect(res.status).toBe("ELERROR");
      expect(res.validationError).toContain("/engine-api/errors/internal");
    });
  });

  describe("notifyForkchoiceUpdate", () => {
    const attributes: PayloadAttributes = {
      timestamp: 1700000000,
      prevRandao: hash,
      suggestedFeeRecipient: `0x${"aa".repeat(20)}`,
      withdrawals: [{index: 1, validatorIndex: 2, address: fromHex(`0x${"bb".repeat(20)}`), amount: 3n}],
      parentBeaconBlockRoot: hash,
    };

    it("sends payload attributes and returns the payload id", async () => {
      const engine = createEngine();
      sszResponse.body = ForkchoiceUpdateResponse.serialize({
        payloadStatus: validStatus,
        payloadId: [fromHex(payloadIdHex)],
      });

      const payloadId = await engine.notifyForkchoiceUpdate(ForkName.deneb, hashHex, hashHex, hashHex, attributes);

      expect(payloadId).toBe(payloadIdHex);
      const req = lastRequest("/engine/v1/forkchoice");
      expect(req.headers["eth-execution-version"]).toBe("cancun");
      expect(ForkchoiceUpdateDeneb.deserialize(req.body as Uint8Array).payloadAttributes).toEqual([
        {
          timestamp: attributes.timestamp,
          prevRandao: hash,
          suggestedFeeRecipient: fromHex(attributes.suggestedFeeRecipient),
          withdrawals: attributes.withdrawals,
          parentBeaconBlockRoot: hash,
        },
      ]);
      expect(
        engine.payloadIdCache.get({
          headBlockHash: hashHex,
          finalizedBlockHash: hashHex,
          timestamp: numToQuantity(attributes.timestamp),
          prevRandao: toHex(hash),
          suggestedFeeRecipient: attributes.suggestedFeeRecipient,
        })
      ).toBe(payloadIdHex);
    });

    it("throws when the execution client is syncing and a payload was requested", async () => {
      const engine = createEngine();
      sszResponse.body = ForkchoiceUpdateResponse.serialize({
        payloadStatus: {status: PayloadStatusCode.SYNCING, latestValidHash: [], validationError: []},
        payloadId: [],
      });

      await expect(
        engine.notifyForkchoiceUpdate(ForkName.deneb, hashHex, hashHex, hashHex, attributes)
      ).rejects.toThrow("Execution Layer Syncing");
    });

    it("surfaces problem responses", async () => {
      const engine = createEngine();
      problem = {status: 409, body: {type: "/engine-api/errors/invalid-forkchoice", detail: "finalized not ancestor"}};

      await expect(engine.notifyForkchoiceUpdate(ForkName.deneb, hashHex, hashHex, hashHex)).rejects.toThrow(
        "status=409 type=/engine-api/errors/invalid-forkchoice detail=finalized not ancestor"
      );
    });
  });

  describe("getPayload", () => {
    it("decodes the built payload", async () => {
      const engine = createEngine();
      const payload = ssz.fulu.ExecutionPayload.defaultValue();
      payload.blockNumber = 9;
      const executionRequests = ssz.electra.ExecutionRequests.defaultValue();
      executionRequests.withdrawals = [ssz.electra.WithdrawalRequest.defaultValue()];
      const blobsBundle = ssz.fulu.BlobsBundle.defaultValue();
      sszResponse.body = BuiltPayloadFulu.serialize({
        payload,
        blockValue: 123n,
        blobsBundle,
        executionRequests: serializeExecutionRequestsToBytes(ForkName.fulu, executionRequests),
        shouldOverrideBuilder: true,
      });

      const res = await engine.getPayload(ForkName.fulu, payloadIdHex);

      expect(res.executionPayload).toEqual(payload);
      expect(res.executionPayloadValue).toBe(123n);
      expect(res.blobsBundle).toEqual(blobsBundle);
      expect(res.executionRequests).toEqual(executionRequests);
      expect(res.shouldOverrideBuilder).toBe(true);

      const req = lastRequest(`/engine/v1/payloads/${payloadIdHex}`);
      expect(req.method).toBe("GET");
      expect(req.headers["eth-execution-version"]).toBe("osaka");
      expect(req.headers.accept).toBe("application/octet-stream");
    });

    it("does not retry an unknown payload", async () => {
      const engine = createEngine();
      problem = {status: 404, body: {type: "/engine-api/errors/unknown-payload"}};

      await expect(engine.getPayload(ForkName.fulu, payloadIdHex)).rejects.toThrow(
        "status=404 type=/engine-api/errors/unknown-payload"
      );
      expect(requests.filter((r) => r.url === `/engine/v1/payloads/${payloadIdHex}`).length).toBe(1);
    });

    it("rejects malformed payload ids", async () => {
      const engine = createEngine();

      await expect(engine.getPayload(ForkName.fulu, "0x1")).rejects.toThrow("Invalid payloadId=0x1");
    });
  });

  describe("payload bodies", () => {
    const withdrawal = {index: 1, validatorIndex: 2, address: fromHex(`0x${"bb".repeat(20)}`), amount: 3n};
    const transactions = [new Uint8Array([0x02, 0xaa]), new Uint8Array([0x03])];

    it("getPayloadBodiesByHashV2 marks unavailable bodies as null", async () => {
      const engine = createEngine();
      const blockAccessList = fromHex("0xc0");
      sszResponse.body = BodiesResponseGloas.serialize({
        entries: [
          {available: true, body: {transactions, withdrawals: [withdrawal], blockAccessList}},
          {available: false, body: {transactions: [], withdrawals: [], blockAccessList: new Uint8Array()}},
        ],
      });

      const bodies = await engine.getPayloadBodiesByHashV2([hashHex, hashHex]);

      expect(bodies).toEqual([{transactions, withdrawals: [withdrawal], blockAccessList}, null]);
      const req = lastRequest("/engine/v1/bodies/hash");
      expect(req.headers["eth-execution-version"]).toBe("amsterdam");
      expect(BodiesByHashRequest.deserialize(req.body as Uint8Array)).toEqual({blockHashes: [hash, hash]});
    });

    it("getPayloadBodiesByRange returns the truncated response", async () => {
      const engine = createEngine();
      sszResponse.body = BodiesResponseCapella.serialize({
        entries: [{available: true, body: {transactions, withdrawals: [withdrawal]}}],
      });

      const bodies = await engine.getPayloadBodiesByRange(ForkName.capella, 2, 3);

      expect(bodies).toEqual([{transactions, withdrawals: [withdrawal]}]);
      const req = lastRequest("/engine/v1/bodies?from=2&count=3");
      expect(req.headers["eth-execution-version"]).toBe("shanghai");
    });
  });

  describe("getBlobs", () => {
    const blob = ssz.deneb.Blob.defaultValue();
    blob[0] = 0x11;
    const proof = fromHex(`0x${"cc".repeat(48)}`);

    it("returns null on 204 for blobs/v2", async () => {
      const engine = createEngine();
      sszResponse = {status: 204, body: new Uint8Array()};

      expect(await engine.getBlobs(ForkName.fulu, [hash])).toBeNull();

      const req = lastRequest("/engine/v1/blobs/v2");
      expect(req.headers["eth-execution-version"]).toBeUndefined();
      expect(BlobsRequest.deserialize(req.body as Uint8Array)).toEqual({versionedHashes: [hash]});
    });

    it("decodes blobs/v2 into the provided buffers", async () => {
      const engine = createEngine();
      const proofs = Array.from({length: 128}, () => proof);
      sszResponse.body = BlobsV2Response.serialize({entries: [{available: true, contents: {blob, proofs}}]});
      // Callers preallocate buffers for the max blobs per block, more buffers than hashes is expected
      const buffers = [new Uint8Array(BLOB_AND_PROOF_V2_RPC_BYTES), new Uint8Array(BLOB_AND_PROOF_V2_RPC_BYTES)];

      const res = await engine.getBlobs(ForkName.fulu, [hash], buffers);

      expect(res).toEqual([{blob, proofs}]);
      expect(res?.[0].blob.buffer).toBe(buffers[0].buffer);
      expect(buffers[0][0]).toBe(0x11);
    });

    it("returns partial results for blobs/v1", async () => {
      const engine = createEngine();
      sszResponse.body = BlobsV1Response.serialize({
        entries: [
          {available: true, contents: {blob, proof}},
          {available: false, contents: {blob: ssz.deneb.Blob.defaultValue(), proof: new Uint8Array(48)}},
        ],
      });

      const res = await engine.getBlobs(ForkName.deneb, [hash, hash]);

      expect(res).toEqual([{blob, proof}, null]);
      expect(lastRequest("/engine/v1/blobs/v1").method).toBe("POST");
    });
  });
});
