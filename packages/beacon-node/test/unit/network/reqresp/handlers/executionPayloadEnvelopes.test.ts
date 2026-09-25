import {PeerId} from "@libp2p/interface";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {PayloadStatus} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {RespStatus, ResponseError} from "@lodestar/reqresp";
import {gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconChain} from "../../../../../src/chain/chain.js";
import {IBeaconChain} from "../../../../../src/chain/index.js";
import {BeaconDb} from "../../../../../src/db/beacon.js";
import {encodeArchivedHeaderEnvelope} from "../../../../../src/db/repositories/index.js";
import {IExecutionEngine} from "../../../../../src/execution/index.js";
import {onExecutionPayloadEnvelopesByRange} from "../../../../../src/network/reqresp/handlers/executionPayloadEnvelopesByRange.js";
import {onExecutionPayloadEnvelopesByRoot} from "../../../../../src/network/reqresp/handlers/executionPayloadEnvelopesByRoot.js";
import {toSignedHeaderEnvelope} from "../../../../../src/util/headerEnvelope.js";
import {startIsolatedTmpBeaconDb} from "../../../../utils/db.js";
import {
  generateProtoBlock,
  generateSignedExecutionPayloadEnvelope,
  payloadBodiesOf,
} from "../../../../utils/typeGenerator.js";

/**
 * Peer-facing behaviour of the two envelope handlers: what a peer sees when an archived envelope cannot
 * be rebuilt. The generator itself is covered in util/execution.test.ts; this pins the reqresp mapping.
 */
describe("ExecutionPayloadEnvelopes reqresp handlers", () => {
  const config = createChainForkConfig({GLOAS_FORK_EPOCH: 0});
  const logger = testLogger();
  const peerId = {toString: () => "test-peer"} as PeerId;
  const finalizedSlot = 20;
  let db: BeaconDb;
  let closeDb: () => Promise<void>;
  let getPayloadBodiesByHashV2: ReturnType<typeof vi.fn>;
  let chain: IBeaconChain;

  beforeEach(async () => {
    ({db, close: closeDb} = await startIsolatedTmpBeaconDb(config, "lodestar-envelope-handlers-"));
    getPayloadBodiesByHashV2 = vi.fn();
    const executionEngine = {getPayloadBodiesByHashV2} as unknown as IExecutionEngine;
    // A real chain's getters over a stubbed fork choice: finalized at 20, no non-finalized blocks in range
    chain = {
      config,
      logger,
      metrics: null,
      executionEngine,
      db,
      earliestAvailableSlot: 0,
      forkChoice: {
        getFinalizedBlock: () => generateProtoBlock({slot: finalizedSlot}),
        getHead: () => generateProtoBlock({slot: finalizedSlot, payloadStatus: PayloadStatus.FULL}),
        getAllAncestorBlocks: () => [],
        getBlockHexDefaultStatus: () => null,
      },
      seenPayloadEnvelopeInputCache: {get: () => undefined},
      serializedCache: {get: () => undefined},
      getSerializedExecutionPayloadEnvelopes: BeaconChain.prototype.getSerializedExecutionPayloadEnvelopes,
      getSerializedExecutionPayloadEnvelope: BeaconChain.prototype.getSerializedExecutionPayloadEnvelope,
    } as unknown as IBeaconChain;
  });

  afterEach(() => closeDb());

  async function seed(slot: number): Promise<gloas.SignedExecutionPayloadEnvelope> {
    const full = generateSignedExecutionPayloadEnvelope(slot);
    await db.executionPayloadEnvelopeArchive.putBinary(
      slot,
      encodeArchivedHeaderEnvelope(toSignedHeaderEnvelope(full))
    );
    await db.blockArchive.putBinary(
      slot,
      ssz.gloas.SignedBeaconBlock.serialize(ssz.gloas.SignedBeaconBlock.defaultValue())
    );
    return full;
  }

  function elServes(fulls: gloas.SignedExecutionPayloadEnvelope[]): void {
    const byHash = new Map(fulls.map((f) => [toRootHex(f.message.payload.blockHash), payloadBodiesOf(f)]));
    getPayloadBodiesByHashV2.mockImplementation(async (hashes: string[]) => hashes.map((h) => byHash.get(h) ?? null));
  }

  async function byRange(startSlot: number, count: number): Promise<number[]> {
    const slots: number[] = [];
    for await (const {data} of onExecutionPayloadEnvelopesByRange({startSlot, count}, chain, db, peerId, "test")) {
      slots.push(ssz.gloas.SignedExecutionPayloadEnvelope.deserialize(data).message.payload.slotNumber);
    }
    return slots;
  }

  const respStatusOf = (p: Promise<unknown>): Promise<RespStatus | null> =>
    p.then(
      () => null,
      (e) => (e instanceof ResponseError ? e.status : Promise.reject(e))
    );

  describe("by-range", () => {
    it("ends the response short after the last servable envelope instead of erroring", async () => {
      const fulls = [await seed(10), await seed(11), await seed(12)];
      elServes([fulls[0], fulls[1]]); // 12 pruned on the EL
      expect(await byRange(10, 3)).toEqual([10, 11]);
    });

    it("responds RESOURCE_UNAVAILABLE when the first requested envelope cannot be served", async () => {
      const fulls = [await seed(10), await seed(11)];
      elServes([fulls[1]]); // 10 pruned, 11 servable but never reached
      expect(await respStatusOf(byRange(10, 2))).toBe(RespStatus.RESOURCE_UNAVAILABLE);
    });

    it("maps an EL outage to RESOURCE_UNAVAILABLE, not SERVER_ERROR", async () => {
      await seed(10);
      getPayloadBodiesByHashV2.mockRejectedValue(new Error("ECONNREFUSED"));
      expect(await respStatusOf(byRange(10, 1))).toBe(RespStatus.RESOURCE_UNAVAILABLE);
    });
  });

  describe("by-root", () => {
    it("omits a mismatched envelope and serves the rest", async () => {
      const fulls = [await seed(10), await seed(11)];
      const bad = payloadBodiesOf(fulls[0]);
      bad.transactions = [Uint8Array.from([0xff])];
      getPayloadBodiesByHashV2.mockResolvedValue([bad, payloadBodiesOf(fulls[1])]);
      // Roots resolve through blockArchive.getSlotByRoot; stub it to map our two roots to their slots
      const roots = fulls.map((f) => f.message.beaconBlockRoot);
      vi.spyOn(db.blockArchive, "getSlotByRoot").mockImplementation(async (root) =>
        toRootHex(root) === toRootHex(roots[0]) ? 10 : toRootHex(root) === toRootHex(roots[1]) ? 11 : null
      );

      const slots: number[] = [];
      for await (const {data} of onExecutionPayloadEnvelopesByRoot(roots, chain, db, peerId, "test")) {
        slots.push(ssz.gloas.SignedExecutionPayloadEnvelope.deserialize(data).message.payload.slotNumber);
      }
      expect(slots).toEqual([11]);
    });
  });
});
