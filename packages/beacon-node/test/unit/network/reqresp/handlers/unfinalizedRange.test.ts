import {PeerId} from "@libp2p/interface";
import {describe, expect, it, vi} from "vitest";
import {PayloadStatus} from "@lodestar/fork-choice";
import {toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../../../src/chain/interface.js";
import {ServingContext} from "../../../../../src/chain/serving/context.js";
import {IBeaconDb} from "../../../../../src/db/interface.js";
import {
  collectServingHeadRange,
  onBeaconBlocksByRange,
} from "../../../../../src/network/reqresp/handlers/beaconBlocksByRange.js";
import {resolveServingPolicy} from "../../../../../src/network/reqresp/serving/policy.js";
import {servingConfig} from "../../../../utils/network/reqresp/servingCases.js";

const config = servingConfig();
const policy = resolveServingPolicy(config, 6, 0);
const peer = {toString: () => "peer"} as PeerId;

function fixture(slots: number[]) {
  const nodes = slots.map((slot) => {
    const root = new Uint8Array(32);
    new DataView(root.buffer).setUint32(0, slot);
    return {slot, blockRoot: toRootHex(root), payloadStatus: PayloadStatus.FULL};
  });
  let head = nodes[0];
  const read = vi.fn(async (root: string) => ({block: Uint8Array.from(Buffer.from(root.slice(2), "hex"))}));
  const chain = {
    config,
    earliestAvailableSlot: 0,
    forkChoice: {
      getHead: () => head,
      getFinalizedCheckpointSlot: () => 0,
      iterateAncestorBlocks: () => nodes.slice(1).values(),
      getAllAncestorBlocks: vi.fn(() => {
        throw Error("Bounded serving must not materialize the full chain");
      }),
    },
    getSerializedBlockByRoot: read,
  } as unknown as IBeaconChain;
  const db = {} as unknown as IBeaconDb;
  return {
    chain,
    db,
    nodes,
    read,
    reorg: () => {
      head = {...head, blockRoot: "replacement"};
    },
  };
}

describe("unfinalized serving range", () => {
  it("serves an available one-slot range more than 8192 ancestors behind the head", async () => {
    const {chain, db, read} = fixture(Array.from({length: 9001}, (_, index) => 9000 - index));
    const responses = await Array.fromAsync(
      onBeaconBlocksByRange({startSlot: 1, count: 1, step: 1}, chain, db, peer, "test", new ServingContext(policy))
    );
    expect(responses).toHaveLength(1);
    expect(read).toHaveBeenCalledOnce();
    expect(new DataView(responses[0].data.buffer).getUint32(0)).toBe(1);
    expect(chain.forkChoice.getAllAncestorBlocks).not.toHaveBeenCalled();
  });

  it("keeps sparse requested records independent of a reorg and node mutation between reads", async () => {
    const {chain, db, nodes, read, reorg} = fixture([10, 8, 4, 2, 0]);
    const original = nodes
      .filter(({slot}) => slot === 2 || slot === 4)
      .map(({blockRoot}) => blockRoot)
      .reverse();
    const iterator = onBeaconBlocksByRange(
      {startSlot: 1, count: 4, step: 1},
      chain,
      db,
      peer,
      "test",
      new ServingContext(policy)
    )[Symbol.asyncIterator]();
    try {
      expect((await iterator.next()).done).toBe(false);
      reorg();
      nodes[2].slot = 99;
      nodes[2].blockRoot = "mutated";
      expect((await iterator.next()).done).toBe(false);
      expect((await iterator.next()).done).toBe(true);
      expect(read.mock.calls.map(([root]) => root)).toEqual(original);
    } finally {
      await iterator.return?.();
    }
  });

  it("retains range-size, archive-boundary and cancellation checks", () => {
    const {chain} = fixture([10, 8, 4, 2, 0]);
    const context = new ServingContext(policy);
    expect(collectServingHeadRange(chain, 1, 5, 2, context).map(({slot}) => slot)).toEqual([4]);
    expect(() => collectServingHeadRange(chain, 0, policy.maxIteratorRows + 1, 0, context)).toThrow("range slots");
    context.cancel();
    expect(() => collectServingHeadRange(chain, 1, 5, 0, context)).toThrow("Serving cancelled");
  });
});
