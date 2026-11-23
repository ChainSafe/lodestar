import {fastify} from "fastify";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createFastifyRoutes} from "@lodestar/api/server";
import {createBeaconConfig} from "@lodestar/config";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {IBeaconStateView, createBeaconStateView} from "@lodestar/state-transition";
// biome-ignore lint/correctness/useImportExtensions: the fixture is JSON and requires its .json extension
import vectors from "../../../../../../../docs/static/proofs/compact-proof-vectors.json" with {type: "json"};
import {getProofApi} from "../../../../../src/api/impl/proof/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {SyncState} from "../../../../../src/sync/index.js";
import {getApiTestModules} from "../../../../utils/api.js";
import {generateProtoBlock} from "../../../../utils/typeGenerator.js";
import {createProofFixture, proofConfig, proofForks} from "./fixtures.js";

const backends = process.env.LODESTAR_NATIVE_STATE_TRANSITION === "true" ? [false, true] : [false];
const hex = (bytes: Uint8Array) => `0x${Buffer.from(bytes).toString("hex")}`;

describe.each(backends)("proof format over HTTP (native=%s)", (nativeStateTransition) => {
  const modules = getApiTestModules({config: proofConfig});

  describe.each(proofForks)("%s", (fork) => {
    const fixture = createProofFixture(fork);
    const server = fastify();
    let view: IBeaconStateView;

    beforeAll(() => {
      pubkeyCache.ensureCapacity(fixture.state.validators.length);
      view = createBeaconStateView({
        nativeStateTransition,
        config: createBeaconConfig(proofConfig, fixture.state.genesisValidatorsRoot),
        stateBytes: fixture.stateType.serialize(fixture.state),
      });
      modules.chain.getHeadState.mockReturnValue(view);
      modules.chain.getStateByStateRoot = vi
        .fn()
        .mockResolvedValue({state: view, executionOptimistic: false, finalized: true});
      modules.chain.getBlockByRoot.mockResolvedValue({
        block: {message: fixture.block, signature: new Uint8Array(96)},
        executionOptimistic: false,
        finalized: true,
      });
      modules.forkChoice.getFinalizedBlock.mockReturnValue(generateProtoBlock({slot: view.slot}));
      Object.defineProperty(modules.chain.clock, "currentSlot", {value: view.slot});
      Object.defineProperty(modules.sync, "state", {value: SyncState.Synced});
      const definitions = createFastifyRoutes(
        routes.proof.getDefinitions(proofConfig),
        getProofApi(defaultApiOptions, modules)
      );
      server.route(definitions.getStateProof);
      server.route(definitions.getBlockProof);
    });

    afterAll(async () => {
      await server.close();
      view?.release();
    });

    describe.each(["state", "block"])("%s", (kind) => {
      const vector = vectors.vectors.find((vector) => vector.fixture === `${fork}-${kind}`);
      if (!vector) throw Error(`Missing ${fork}-${kind} vector`);
      const url = `/eth/v0/beacon/proof/${kind}/${vector.expectedRoot}`;

      it.each(["application/json", "application/octet-stream"])("serves the frozen vector as %s", async (accept) => {
        const response = await server.inject({url: `${url}?format=${vector.descriptor}`, headers: {accept}});
        expect(response.statusCode).toBe(200);
        expect(response.headers["eth-consensus-version"]).toBe(fork);
        expect(response.headers["content-type"]).toContain(accept);
        if (accept === "application/json") {
          const body = response.json();
          expect(body).toEqual({version: fork, data: {descriptor: vector.descriptor, leaves: vector.leaves}});
        } else {
          expect(hex(response.rawPayload)).toBe(vector.ssz);
        }
      });

      it("serves a root-only proof, including the legacy unprefixed request encoding", async () => {
        for (const format of ["0x80", "80"]) {
          const response = await server.inject({url: `${url}?format=${format}`});
          expect(response.statusCode, format).toBe(200);
          expect(response.json(), format).toEqual({
            version: fork,
            data: {descriptor: "0x80", leaves: [vector.expectedRoot]},
          });
        }
      });

      it.each([
        ["missing format", "", 400],
        ["odd hex length", "?format=0x8", 400],
        ["invalid hex", "?format=0xzz", 400],
        ["empty descriptor", "?format=0x", 400],
        ["unfinished tree", "?format=0x00", 400],
        ["extra byte", "?format=0x8000", 400],
        ["nonzero padding", "?format=0x81", 400],
        ["descriptor byte guard", `?format=0x80${"00".repeat(1024)}`, 413],
      ] as const)("rejects %s", async (_name, query, status) => {
        const response = await server.inject({url: `${url}${query}`});
        expect(response.statusCode).toBe(status);
      });

      it("rejects unsupported response encodings", async () => {
        const response = await server.inject({url: `${url}?format=0x80`, headers: {accept: "text/plain"}});
        expect(response.statusCode).toBe(406);
      });
    });
  });
});
