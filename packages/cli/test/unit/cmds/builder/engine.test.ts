import {createHmac} from "node:crypto";
import {getEventListeners} from "node:events";
import {readFileSync} from "node:fs";
import {FastifyInstance, fastify} from "fastify";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {EnginePayloadSource} from "@lodestar/builder";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ErrorAborted, fromHex, toHex} from "@lodestar/utils";
import {BuilderEngineErrorCode, createPayloadSourceEngine} from "../../../../src/cmds/builder/engine.js";
import {testLogger} from "../../../utils.js";

const fixtures: {forkchoice: string; payload: string} = JSON.parse(
  readFileSync(new URL("./engineSsz.json", import.meta.url), "utf8")
);
const hash = toHex(new Uint8Array(32).fill(1));
const payloadId = "0x0102030405060708";
const jwtSecret = new Uint8Array(32).fill(2);
const logger = testLogger();
const forkchoiceState = {headBlockHash: hash, safeBlockHash: hash, finalizedBlockHash: hash};

describe("Builder shared Engine connection", () => {
  let server: FastifyInstance;
  let url: string;
  let controller: AbortController;
  let capabilitiesStatus: number;
  let failureStatus: number | undefined;
  let failOnce: boolean;
  let rpcStatus: string;
  let rpcPayloadId: string | null;
  let methodError: boolean;
  let gate: Promise<void> | undefined;
  let releaseGate: (() => void) | undefined;
  let discoveryGate: Promise<void> | undefined;
  let releaseDiscovery: (() => void) | undefined;
  let requests: {path: string; body: unknown; authorization?: string}[];

  beforeEach(async () => {
    controller = new AbortController();
    capabilitiesStatus = 200;
    failureStatus = undefined;
    failOnce = false;
    rpcStatus = "VALID";
    rpcPayloadId = payloadId;
    methodError = false;
    gate = undefined;
    releaseGate = undefined;
    discoveryGate = undefined;
    releaseDiscovery = undefined;
    requests = [];
    server = fastify({forceCloseConnections: true});
    server.addContentTypeParser("application/octet-stream", {parseAs: "buffer"}, (_, body, done) => done(null, body));
    server.get("/engine/v1/capabilities", async (_, reply) => {
      await discoveryGate;
      return reply.code(capabilitiesStatus).send({supported_forks: ["amsterdam"]});
    });
    server.get("/engine/v1/identity", () => [{code: "GE", name: "Geth", version: "test", commit: "0x12345678"}]);
    for (const path of ["/engine/v1/forkchoice", `/engine/v1/payloads/${payloadId}`, "/"]) {
      server.route({
        method: path.includes("/payloads/") ? "GET" : "POST",
        url: path,
        handler: async (req, reply) => {
          const rpc = req.body as {method?: string; id?: number};
          if (rpc?.method === "engine_getClientVersionV1") {
            return {id: rpc.id, result: [{code: "GE", name: "Geth", version: "test", commit: "0x12345678"}]};
          }
          requests.push({path: req.url, body: req.body, authorization: req.headers.authorization});
          await gate;
          if (failureStatus !== undefined) {
            const status = failureStatus;
            if (failOnce) failureStatus = undefined;
            return reply.code(status).send({type: "/engine-api/errors/invalid-params"});
          }
          if (path !== "/") {
            return reply
              .type("application/octet-stream")
              .send(Buffer.from(fromHex(path.includes("/payloads/") ? fixtures.payload : fixtures.forkchoice)));
          }
          if (methodError) return {id: rpc.id, error: {code: -32601, message: "Method not found"}};
          return {
            id: rpc.id,
            result:
              rpc.method === "engine_getPayloadV6"
                ? payloadResponse()
                : {
                    payloadId: rpcPayloadId,
                    payloadStatus: {status: rpcStatus, latestValidHash: null, validationError: "test"},
                  },
          };
        },
      });
    }
    url = await server.listen({port: 0, host: "127.0.0.1"});
  });

  afterEach(async () => {
    controller.abort();
    releaseGate?.();
    releaseDiscovery?.();
    await server.close();
  });

  function engine(engineApi: "auto" | "ssz" | "json-rpc" = "auto") {
    return createPayloadSourceEngine({url, jwtSecret, signal: controller.signal, logger, engineApi});
  }

  function prepare(connection = engine(), signal = new AbortController().signal) {
    return new EnginePayloadSource("local", connection).prepare(
      {fork: ForkName.gloas, forkchoiceState, payloadAttributes: ssz.gloas.PayloadAttributes.defaultValue()},
      signal
    );
  }

  it.each(["auto", "ssz", "json-rpc"] as const)("prepares and retrieves a Gloas payload using %s", async (mode) => {
    const source = new EnginePayloadSource("local", engine(mode));
    const handle = await prepare(engine(mode));
    const result = await source.getPayload(handle, new AbortController().signal);
    expect(result.executionPayload).toEqual(ssz.gloas.ExecutionPayload.defaultValue());
    expect(result.executionPayloadValue).toBe(123n);
    expect(result.blobsBundle).toEqual({blobs: [], commitments: [], proofs: []});
    expect(result.executionRequests).toEqual(ssz.gloas.ExecutionRequests.defaultValue());
    expect(requests.map((req) => req.path)).toEqual(
      mode === "json-rpc" ? ["/", "/"] : ["/engine/v1/forkchoice", `/engine/v1/payloads/${payloadId}`]
    );
    const [header, claim, signature] = (requests[0].authorization ?? "").replace("Bearer ", "").split(".");
    expect(signature).toBe(createHmac("sha256", jwtSecret).update(`${header}.${claim}`).digest("base64url"));
    expect(Math.abs(JSON.parse(Buffer.from(claim, "base64url").toString()).iat - Date.now() / 1000)).toBeLessThan(5);
  });

  it("uses JSON-RPC when the EL has no REST API", async () => {
    capabilitiesStatus = 404;
    await prepare();
    expect(requests[0]).toMatchObject({
      path: "/",
      body: {method: "engine_forkchoiceUpdatedV4", params: [forkchoiceState, expect.any(Object), null]},
    });
  });

  it("does not hide a capabilities authentication failure with JSON-RPC fallback", async () => {
    capabilitiesStatus = 401;
    await expect(prepare()).rejects.toMatchObject({status: 401});
    expect(requests).toHaveLength(0);
  });

  for (const mode of ["ssz", "json-rpc"] as const) {
    it(`cleans up ${mode} cancellation listeners after successful and failed requests`, async () => {
      const connection = engine(mode);
      const signal = new AbortController().signal;
      const baseline = getEventListeners(controller.signal, "abort").length;
      await prepare(connection, signal);
      await expect.poll(() => getEventListeners(controller.signal, "abort").length).toBe(baseline);
      for (let i = 0; i < 3; i++) {
        await prepare(connection, signal);
        expect(getEventListeners(controller.signal, "abort").length, `connection listeners after request ${i}`).toBe(
          baseline
        );
        expect(getEventListeners(signal, "abort"), `request listeners after request ${i}`).toHaveLength(0);
      }
      failureStatus = 401;
      await expect(prepare(connection, signal)).rejects.toThrow();
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(baseline);
      expect(getEventListeners(signal, "abort")).toHaveLength(0);
    });

    it.each([null, [], [0, 7, 127]])(`preserves ${mode} custody argument %j`, async (columns) => {
      await engine(mode).notifyForkchoiceUpdate(
        ForkName.gloas,
        hash,
        hash,
        hash,
        ssz.gloas.PayloadAttributes.defaultValue(),
        columns,
        controller.signal
      );
      const expected = new Uint8Array(16);
      for (const column of columns ?? []) expected[Math.floor(column / 8)] |= 1 << (column % 8);
      if (mode === "json-rpc") {
        expect((requests[0].body as {params: unknown[]}).params[2]).toBe(columns === null ? null : toHex(expected));
      } else {
        const body = requests[0].body as Buffer;
        const custodyOffset = body.readUInt32LE(100);
        expect(body.subarray(custodyOffset)).toEqual(Buffer.from(columns === null ? [] : expected));
      }
    });

    it(`cancels ${mode} retry backoff`, async () => {
      failureStatus = 503;
      const requestController = new AbortController();
      const pending = expect(prepare(engine(mode), requestController.signal)).rejects.toThrow(ErrorAborted);
      await expect.poll(() => requests.length, {interval: 1}).toBe(1);
      requestController.abort();
      await pending;
      expect(requests).toHaveLength(1);
    });

    it(`does not send pre-cancelled ${mode} preparation or retrieval`, async () => {
      const connection = engine(mode);
      const signal = AbortSignal.abort();
      await expect(prepare(connection, signal)).rejects.toThrow(ErrorAborted);
      await expect(connection.getPayload(ForkName.gloas, payloadId, signal)).rejects.toThrow(ErrorAborted);
      expect(requests).toHaveLength(0);
    });
  }

  it.each([-1, 128, 0.5, NaN])("rejects invalid custody column %s before sending", async (column) => {
    await expect(
      engine().notifyForkchoiceUpdate(
        ForkName.gloas,
        hash,
        hash,
        hash,
        ssz.gloas.PayloadAttributes.defaultValue(),
        [column],
        controller.signal
      )
    ).rejects.toMatchObject({type: {code: BuilderEngineErrorCode.INVALID_CUSTODY_COLUMN}});
    expect(requests).toHaveLength(0);
  });

  it.each(["ssz", "json-rpc"] as const)("retries transient %s failures with unchanged content", async (mode) => {
    failureStatus = 503;
    failOnce = true;
    await prepare(engine(mode));
    expect(requests).toHaveLength(2);
    if (mode === "ssz") expect(requests[0].body).toEqual(requests[1].body);
    else expect(requests[1].body).toMatchObject({params: (requests[0].body as {params: unknown[]}).params});
  });

  it.each(["ssz", "json-rpc"] as const)("bounds %s transport retries", async (mode) => {
    failureStatus = 503;
    await expect(prepare(engine(mode))).rejects.toMatchObject({status: 503});
    expect(requests).toHaveLength(3);
  });

  for (const mode of ["ssz", "json-rpc"] as const) {
    it.each([400, 401, 403, 404])(`does not retry ${mode} HTTP %s`, async (status) => {
      failureStatus = status;
      await expect(prepare(engine(mode))).rejects.toMatchObject({status});
      expect(requests).toHaveLength(1);
    });
  }

  it.each(["ssz", "json-rpc"] as const)("cancels a %s request without cancelling the connection", async (mode) => {
    gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const requestController = new AbortController();
    const connection = engine(mode);
    const pending = expect(prepare(connection, requestController.signal)).rejects.toThrow(ErrorAborted);
    await expect.poll(() => requests.length).toBe(1);
    requestController.abort();
    await pending;
    releaseGate?.();
    gate = undefined;
    await expect(prepare(connection)).resolves.toMatchObject({payloadId});
    expect(controller.signal.aborted).toBe(false);
  });

  it("cancels a discovery waiter without aborting shared discovery", async () => {
    discoveryGate = new Promise<void>((resolve) => {
      releaseDiscovery = resolve;
    });
    const connection = engine();
    const requestController = new AbortController();
    const pending = expect(prepare(connection, requestController.signal)).rejects.toThrow(ErrorAborted);
    requestController.abort();
    await pending;
    expect(requests).toHaveLength(0);
    releaseDiscovery?.();
    await expect(prepare(connection)).resolves.toMatchObject({payloadId});
    expect(requests).toHaveLength(1);
  });

  it.each([null, "0x"])("rejects unusable JSON-RPC payload ID %s", async (value) => {
    rpcPayloadId = value;
    await expect(prepare(engine("json-rpc"))).rejects.toMatchObject({
      type: {code: "PAYLOAD_SOURCE_ERROR_NO_PAYLOAD_ID"},
    });
  });

  it.each(["INVALID", "ACCEPTED"])("rejects %s without creating a handle", async (status) => {
    rpcStatus = status;
    await expect(prepare(engine("json-rpc"))).rejects.toMatchObject({
      type: {code: BuilderEngineErrorCode.PAYLOAD_NOT_VALID, status},
    });
  });

  it("leaves SYNCING retryable by the orchestrator", async () => {
    rpcStatus = "SYNCING";
    rpcPayloadId = null;
    await expect(prepare(engine("json-rpc"))).rejects.toMatchObject({
      type: {code: "PAYLOAD_SOURCE_ERROR_NO_PAYLOAD_ID"},
    });
  });

  it("does not retry unsupported JSON-RPC methods", async () => {
    methodError = true;
    await expect(prepare(engine("json-rpc"))).rejects.toMatchObject({response: {error: {code: -32601}}});
    expect(requests).toHaveLength(1);
  });

  it("rejects Heze without sending Engine traffic", async () => {
    await expect(engine().getPayload(ForkName.heze, payloadId, controller.signal)).rejects.toMatchObject({
      type: {code: BuilderEngineErrorCode.UNSUPPORTED_FORK},
    });
    expect(requests).toHaveLength(0);
  });
});

function payloadResponse() {
  const payload = ssz.gloas.ExecutionPayload.toJson(ssz.gloas.ExecutionPayload.defaultValue()) as Record<
    string,
    unknown
  >;
  // The Engine JSON-RPC quantities use hex rather than the consensus JSON decimal representation.
  return {
    executionPayload: {
      parentHash: payload.parent_hash,
      feeRecipient: payload.fee_recipient,
      stateRoot: payload.state_root,
      receiptsRoot: payload.receipts_root,
      logsBloom: payload.logs_bloom,
      prevRandao: payload.prev_randao,
      blockNumber: "0x0",
      gasLimit: "0x0",
      gasUsed: "0x0",
      timestamp: "0x0",
      extraData: "0x",
      baseFeePerGas: "0x0",
      blockHash: payload.block_hash,
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
