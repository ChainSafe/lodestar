import {fastify} from "fastify";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {computeDescriptor} from "@chainsafe/persistent-merkle-tree";
import {routes} from "@lodestar/api";
import {createFastifyRoutes} from "@lodestar/api/server";
import {getProofApi} from "../../../../../src/api/impl/proof/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {SyncState} from "../../../../../src/sync/index.js";
import {getApiTestModules} from "../../../../utils/api.js";
import {generateProtoBlock} from "../../../../utils/typeGenerator.js";
import {proofConfig} from "./fixtures.js";

const modules = getApiTestModules({config: proofConfig});
const root = `0x${"11".repeat(32)}`;

describe.each(["state", "block"] as const)("%s proof request validation", (kind) => {
  const servers: ReturnType<typeof fastify>[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    modules.chain.getStateByStateRoot = vi.fn().mockResolvedValue(null);
    modules.chain.getBlockByRoot.mockReset().mockResolvedValue(null);
    modules.chain.getStateBySlot.mockResolvedValue(null);
    modules.chain.getCanonicalBlockAtSlot.mockResolvedValue(null);
    modules.chain.getHistoricalStateBySlot = vi.fn().mockResolvedValue(null);
    modules.chain.getStateOrBytesByCheckpoint = vi.fn().mockResolvedValue(null);
    modules.forkChoice.getFinalizedBlock.mockReturnValue(generateProtoBlock({slot: 0}));
    Object.defineProperty(modules.chain.clock, "currentSlot", {value: 100});
    Object.defineProperty(modules.sync, "state", {value: SyncState.Synced});
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  function request(descriptor: Uint8Array, id = root, maxGindicesInProof = 512) {
    const server = fastify();
    servers.push(server);
    const definitions = createFastifyRoutes(
      routes.proof.getDefinitions(proofConfig),
      getProofApi({...defaultApiOptions, maxGindicesInProof}, modules)
    );
    if (kind === "state") server.route(definitions.getStateProof);
    else server.route(definitions.getBlockProof);
    return server.inject({
      url: `/eth/v0/beacon/proof/${kind}/${encodeURIComponent(id)}?format=0x${Buffer.from(descriptor).toString("hex")}`,
    });
  }

  function expectNoRetrieval(): void {
    for (const name of [
      "getStateByStateRoot",
      "getStateBySlot",
      "getHistoricalStateBySlot",
      "getStateOrBytesByCheckpoint",
      "getHeadState",
      "getBlockByRoot",
      "getCanonicalBlockAtSlot",
    ] as const) {
      expect(modules.chain[name], name).not.toHaveBeenCalled();
    }
  }

  it.each(["", "00", "40", "81", "61", "8000", "6000"])(
    "rejects malformed descriptor %s before retrieval",
    async (hex) => {
      const response = await request(Buffer.from(hex, "hex"));
      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain("Invalid proof descriptor");
      expectNoRetrieval();
    }
  );

  it.each(["-1", "1.5", "1abc", "1e2", "+1", " 1", "9007199254740992", "0x12", `0x${"gg".repeat(32)}`])(
    "rejects invalid object identifier %s before retrieval",
    async (id) => {
      const response = await request(Uint8Array.of(0x80), id);
      expect(response.statusCode).toBe(400);
      expectNoRetrieval();
    }
  );

  it.each(["0", "01", "100", root])("preserves valid identifier %s", async (id) => {
    const response = await request(Uint8Array.of(0x80), id);
    expect(response.statusCode).toBe(404);
    const lookup = id.startsWith("0x")
      ? kind === "state"
        ? modules.chain.getStateByStateRoot
        : modules.chain.getBlockByRoot
      : kind === "state"
        ? modules.chain.getStateBySlot
        : modules.chain.getCanonicalBlockAtSlot;
    expect(lookup).toHaveBeenCalledOnce();
  });

  it.each([
    ["default", 512, 1024],
    ["lower operator limit", 4, 8],
    ["hard schema limit", 10000, 2048],
  ] as const)("enforces the exact %s byte boundary", async (_name, configured, bytes) => {
    const atLimit = balancedDescriptor(bytes * 4);
    expect(atLimit.length).toBe(bytes);
    expect((await request(atLimit, root, configured)).statusCode).toBe(404);
    vi.clearAllMocks();
    const overLimit = balancedDescriptor(bytes * 4 + 1);
    expect(overLimit.length).toBe(bytes + 1);
    const response = await request(overLimit, root, configured);
    expect(response.statusCode).toBe(413);
    expect(response.json().message).toContain(`${bytes} bytes`);
    expectNoRetrieval();
  });

  it("rejects a proof deeper than the traversal limit before retrieval", async () => {
    const response = await request(computeDescriptor([1n << 257n]));
    expect(response.statusCode).toBe(413);
    expect(response.json().message).toContain("depth");
    expectNoRetrieval();
  });

  it("allows the traversal depth boundary without truncating the index", async () => {
    const response = await request(computeDescriptor([1n << 256n]));
    expect(response.statusCode).toBe(404);
  });

  it("preserves zero as an operator setting that rejects every proof", async () => {
    expect((await request(Uint8Array.of(0x80), root, 0)).statusCode).toBe(413);
    expectNoRetrieval();
  });

  it("preserves internal lookup failures as server errors", async () => {
    modules.chain.getStateByStateRoot.mockRejectedValueOnce(Error("Database failure"));
    modules.chain.getBlockByRoot.mockRejectedValueOnce(Error("Database failure"));
    const response = await request(Uint8Array.of(0x80));
    expect(response.statusCode).toBe(500);
    expect(response.json().message).toBe("Database failure");
  });
});

it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid maxGindicesInProof configuration %s",
  (maxGindicesInProof) => {
    expect(() => getProofApi({...defaultApiOptions, maxGindicesInProof}, modules)).toThrow("maxGindicesInProof");
  }
);

function balancedDescriptor(leaves: number): Uint8Array {
  const bits: number[] = [];
  function visit(count: number): void {
    bits.push(count === 1 ? 1 : 0);
    if (count > 1) {
      visit(Math.floor(count / 2));
      visit(Math.ceil(count / 2));
    }
  }
  visit(leaves);
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (const [i, bit] of bits.entries()) bytes[Math.floor(i / 8)] |= bit << (7 - (i % 8));
  return bytes;
}
