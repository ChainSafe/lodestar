import assert from "node:assert/strict";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {computeDescriptor} from "@chainsafe/persistent-merkle-tree";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {IBeaconStateView, createBeaconStateView} from "@lodestar/state-transition";
import {fetch, toHex} from "@lodestar/utils";
import {getApi} from "../../../../../src/api/impl/api.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {BeaconRestApiServer} from "../../../../../src/api/rest/index.js";
import {SyncState} from "../../../../../src/sync/index.js";
import {QueueError, QueueErrorCode} from "../../../../../src/util/queue/errors.js";
import {getApiTestModules} from "../../../../utils/api.js";
import {generateProtoBlock} from "../../../../utils/typeGenerator.js";
import {createProofFixture, proofConfig, proofForks} from "./fixtures.js";

class ProofServer extends BeaconRestApiServer {
  get url(): string {
    const address = this.server.server.address();
    assert(address && typeof address !== "string");
    return `http://127.0.0.1:${address.port}`;
  }
}

const backends = process.env.LODESTAR_NATIVE_STATE_TRANSITION === "true" ? [false, true] : [false];

describe.each(backends)("proof REST support (native=%s)", (nativeStateTransition) => {
  const modules = getApiTestModules({config: proofConfig});

  describe.each(proofForks)("%s", (fork) => {
    const fixture = createProofFixture(fork);
    const stateRoot = toHex(fixture.stateType.hashTreeRoot(fixture.state));
    const blockRoot = toHex(fixture.blockType.hashTreeRoot(fixture.block));
    let state: IBeaconStateView;
    let server: ProofServer;
    let disabled: ProofServer;

    beforeAll(async () => {
      pubkeyCache.ensureCapacity(fixture.state.validators.length);
      state = createBeaconStateView({
        nativeStateTransition,
        config: createBeaconConfig(proofConfig, fixture.state.genesisValidatorsRoot),
        stateBytes: fixture.stateType.serialize(fixture.state),
      });
      const api = getApi(defaultApiOptions, modules);
      const dependencies = {...modules, api, metrics: null};
      server = new ProofServer({api: ["proof"], port: 0, address: "127.0.0.1"}, dependencies);
      disabled = new ProofServer({api: [], port: 0, address: "127.0.0.1"}, dependencies);
      await server.registerRoutes();
      await disabled.registerRoutes();
      await server.listen();
      await disabled.listen();
    });

    beforeEach(() => {
      vi.clearAllMocks();
      modules.chain.getHeadState.mockReturnValue(state);
      modules.chain.getStateByStateRoot = vi
        .fn()
        .mockResolvedValue({state, executionOptimistic: true, finalized: false});
      modules.chain.getStateBySlot.mockReset().mockResolvedValue({state, executionOptimistic: false, finalized: true});
      modules.chain.getHistoricalStateBySlot = vi.fn().mockResolvedValue(null);
      modules.chain.getBlockByRoot.mockReset().mockResolvedValue({
        block: {message: fixture.block, signature: new Uint8Array(96)},
        executionOptimistic: true,
        finalized: false,
      });
      modules.chain.regen.getStateSync.mockReturnValue(state);
      modules.forkChoice.getHead.mockReturnValue(generateProtoBlock({slot: state.slot, stateRoot, blockRoot}));
      modules.forkChoice.getFinalizedBlock.mockReturnValue(generateProtoBlock({slot: state.slot}));
      modules.forkChoice.getFinalizedCheckpoint.mockReturnValue({
        epoch: 0,
        rootHex: blockRoot,
        root: fixture.blockType.hashTreeRoot(fixture.block),
      });
      Object.defineProperty(modules.chain.clock, "currentSlot", {value: state.slot, configurable: true});
      Object.defineProperty(modules.sync, "state", {value: SyncState.Synced, configurable: true});
    });

    afterEach(() => vi.restoreAllMocks());

    afterAll(async () => {
      await server?.close();
      await disabled?.close();
      state?.release();
    });

    async function request(
      kind: "state" | "block",
      descriptor: Uint8Array = Uint8Array.of(0x80),
      id?: string,
      base = server.url
    ) {
      const response = await fetch(
        `${base}/eth/v0/beacon/proof/${kind}/${id ?? (kind === "state" ? stateRoot : blockRoot)}?format=${toHex(descriptor)}`
      );
      return {status: response.status, body: await response.json()};
    }

    it.each(["state", "block"] as const)("serves %s proofs only when the namespace is enabled", async (kind) => {
      const response = await request(kind);
      expect(response).toEqual({
        status: 200,
        body: {version: fork, data: {descriptor: "0x80", leaves: [kind === "state" ? stateRoot : blockRoot]}},
      });
      const unavailable = await request(kind, Uint8Array.of(0x80), undefined, disabled.url);
      expect(unavailable.status).toBe(404);
      expect(unavailable.body.code).toBe(404);
      expect(unavailable.body).not.toHaveProperty("data");
    });

    it.each(["state", "block"] as const)(
      "rejects %s traversal below a terminal chunk without returning a proof",
      async (kind) => {
        const type = kind === "state" ? fixture.stateType : fixture.blockType;
        const descriptor = computeDescriptor([type.getPathInfo(["slot"]).gindex * 2n]);
        const response = await request(kind, descriptor);
        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({
          code: 400,
          message: "Proof descriptor requests children of a terminal chunk",
        });
        expect(response.body).not.toHaveProperty("data");
        expect(response.body).not.toHaveProperty("stacktraces");
      }
    );

    it.each(["state", "block"] as const)("negotiates SSZ for %s proofs with the selected fork header", async (kind) => {
      const root = kind === "state" ? stateRoot : blockRoot;
      const response = await fetch(`${server.url}/eth/v0/beacon/proof/${kind}/${root}?format=0x80`, {
        headers: {accept: "application/octet-stream"},
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("eth-consensus-version")).toBe(fork);
      expect(response.headers.get("content-type")).toContain("application/octet-stream");
      const proof = routes.proof.CompactMultiProofType.deserialize(new Uint8Array(await response.arrayBuffer()));
      expect(proof.descriptor).toEqual(Uint8Array.of(0x80));
      expect(proof.leaves.map(toHex)).toEqual([root]);
    });

    it.each([
      ["invalid identifier", "-1", "0x80", "application/json", 400],
      ["invalid descriptor", "head", "0x81", "application/octet-stream", 400],
      ["size limit", "head", `0x80${"00".repeat(1024)}`, "application/json", 413],
      ["unsupported encoding", "head", "0x80", "text/plain", 406],
    ] as const)("returns a JSON error for %s without looking up state", async (_name, id, format, accept, code) => {
      const response = await fetch(`${server.url}/eth/v0/beacon/proof/state/${id}?format=${format}`, {
        headers: {accept},
      });
      expect(response.status).toBe(code);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toMatchObject({code, message: expect.any(String)});
      expect(modules.chain.getStateByStateRoot).not.toHaveBeenCalled();
      expect(modules.chain.regen.getStateSync).not.toHaveBeenCalled();
      expect(modules.chain.getHistoricalStateBySlot).not.toHaveBeenCalled();
    });

    it.each(["state", "block"] as const)("returns 404 when the selected %s is unavailable", async (kind) => {
      modules.chain.getStateByStateRoot.mockResolvedValueOnce(null);
      modules.chain.getBlockByRoot.mockResolvedValueOnce(null);
      const response = await request(kind);
      expect(response.status).toBe(404);
      expect(response.body.code).toBe(404);
      expect(response.body).not.toHaveProperty("data");
    });

    it.each(["state", "block"] as const)("keeps %s lookup failures as 500 without stack traces", async (kind) => {
      modules.chain.getStateByStateRoot.mockRejectedValueOnce(Error("Database failure"));
      modules.chain.getBlockByRoot.mockRejectedValueOnce(Error("Database failure"));
      expect(await request(kind)).toEqual({status: 500, body: {code: 500, message: "Database failure"}});
    });

    it("keeps unexpected proof backend failures as 500", async () => {
      vi.spyOn(state, "createMultiProof").mockImplementationOnce(() => {
        throw Object.assign(Error("Unexpected backend failure"), {code: "STATE_ERROR"});
      });
      expect(await request("state")).toEqual({status: 500, body: {code: 500, message: "Unexpected backend failure"}});
    });

    it("returns 404 for unavailable historical data and 500 for reconstruction failures", async () => {
      const slot = state.slot - 1;
      const unavailable = await request("state", Uint8Array.of(0x80), String(slot));
      expect(unavailable.status).toBe(404);
      expect(unavailable.body).toMatchObject({code: 404});
      modules.chain.getHistoricalStateBySlot.mockRejectedValueOnce(Error("Historical reconstruction failed"));
      expect(await request("state", Uint8Array.of(0x80), String(slot))).toEqual({
        status: 500,
        body: {code: 500, message: "Historical reconstruction failed"},
      });
      expect(modules.chain.getHistoricalStateBySlot).toHaveBeenCalledTimes(2);
      expect(modules.chain.getStateBySlot).not.toHaveBeenCalled();
      expect(modules.chain.getStateByStateRoot).not.toHaveBeenCalled();
    });

    it.each([QueueErrorCode.QUEUE_MAX_LENGTH, QueueErrorCode.QUEUE_ABORTED])(
      "returns 503 for historical %s without substituting another state",
      async (code) => {
        const slot = state.slot - 1;
        for (const accept of ["application/json", "application/octet-stream"]) {
          modules.chain.getHistoricalStateBySlot.mockRejectedValueOnce(new QueueError({code}));
          const response = await fetch(`${server.url}/eth/v0/beacon/proof/state/${slot}?format=0x80`, {
            headers: {accept},
          });
          expect(response.status, accept).toBe(503);
          expect(response.headers.get("content-type"), accept).toContain("application/json");
          expect(await response.json(), accept).toEqual({
            code: 503,
            message: "Historical state reconstruction is temporarily unavailable",
          });
        }
        expect(modules.chain.getHistoricalStateBySlot).toHaveBeenLastCalledWith(slot);
        expect(modules.chain.getStateBySlot).not.toHaveBeenCalled();
        expect(modules.chain.getStateByStateRoot).not.toHaveBeenCalled();
        expect(modules.chain.regen.getStateSync).not.toHaveBeenCalled();
      }
    );

    it("keeps queue-like unexpected historical errors as 500", async () => {
      const failure = Object.assign(new Error(QueueErrorCode.QUEUE_MAX_LENGTH), {
        type: {code: QueueErrorCode.QUEUE_MAX_LENGTH},
      });
      modules.chain.getHistoricalStateBySlot.mockRejectedValueOnce(failure);
      expect(await request("state", Uint8Array.of(0x80), String(state.slot - 1))).toEqual({
        status: 500,
        body: {code: 500, message: QueueErrorCode.QUEUE_MAX_LENGTH},
      });
    });

    it.each([SyncState.Stalled, SyncState.SyncingHead, SyncState.SyncingFinalized])(
      "guards regenerating state requests while %s but serves cached head and blocks",
      async (syncState) => {
        Object.defineProperty(modules.sync, "state", {value: syncState});
        Object.defineProperty(modules.chain.clock, "currentSlot", {value: state.slot + SLOTS_PER_EPOCH * 3});
        for (const id of [stateRoot, String(state.slot)]) {
          const response = await request("state", Uint8Array.of(0x80), id);
          expect(response.status, id).toBe(503);
          expect(response.body.code, id).toBe(503);
        }
        expect(modules.chain.getStateByStateRoot).not.toHaveBeenCalled();
        expect(modules.chain.getStateBySlot).not.toHaveBeenCalled();
        expect((await request("state", Uint8Array.of(0x80), "head")).status).toBe(200);
        expect((await request("block")).status).toBe(200);
      }
    );

    it("serves concurrent state and block requests without changing cached state ownership", async () => {
      const release = vi.spyOn(state, "release");
      const responses = await Promise.all(Array.from({length: 8}, (_, i) => request(i % 2 === 0 ? "state" : "block")));
      for (const [i, response] of responses.entries()) {
        expect(response.status, `request ${i}`).toBe(200);
        expect(response.body.data.leaves, `request ${i}`).toEqual([i % 2 === 0 ? stateRoot : blockRoot]);
      }
      expect(release).not.toHaveBeenCalled();
      expect(toHex(state.hashTreeRoot())).toBe(stateRoot);
    });
  });
});
