import {PeerId} from "@libp2p/interface";
import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {PayloadStatus} from "@lodestar/fork-choice";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../../../src/chain/interface.js";
import {IBeaconDb} from "../../../../../src/db/interface.js";
import {
  collectHeadRange,
  onBeaconBlocksByRange,
} from "../../../../../src/network/reqresp/handlers/beaconBlocksByRange.js";
import {onDataColumnSidecarsByRange} from "../../../../../src/network/reqresp/handlers/dataColumnSidecarsByRange.js";

const config = createBeaconConfig({}, new Uint8Array(32));
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
      getAllAncestorBlocks: vi.fn(() => nodes),
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
  it("limits the archive iterator to the normalized request count", async () => {
    const {chain} = fixture([10, 4, 0]);
    chain.forkChoice.getFinalizedCheckpointSlot = () => 4;
    const binaryEntriesStream = vi.fn(async function* () {});
    const db = {blockArchive: {binaryEntriesStream}} as unknown as IBeaconDb;
    await Array.fromAsync(onBeaconBlocksByRange({startSlot: 1, count: 4, step: 1}, chain, db, peer, "test"));
    expect(binaryEntriesStream).toHaveBeenCalledExactlyOnceWith({gte: 1, lt: 5, limit: 4});
  });

  it("keeps column range records independent of node mutation between reads", async () => {
    const {chain, db, nodes} = fixture([10, 8, 4, 2, 0]);
    const originalRoots = [nodes[3].blockRoot, nodes[2].blockRoot];
    const readColumns = vi.fn(async () => [new Uint8Array(1)]);
    const columnChain = {
      ...chain,
      config: createBeaconConfig({FULU_FORK_EPOCH: 0}, new Uint8Array(32)),
      clock: {currentEpoch: 0},
      custodyConfig: {custodyColumnsIndex: new Uint8Array(NUMBER_OF_COLUMNS).fill(1)},
      forkChoice: {...chain.forkChoice, getFinalizedBlock: () => ({slot: 0})},
      getSerializedDataColumnSidecars: readColumns,
    } as unknown as IBeaconChain;
    const iterator = onDataColumnSidecarsByRange({startSlot: 1, count: 4, columns: [0]}, columnChain, db, peer, "test")[
      Symbol.asyncIterator
    ]();
    try {
      expect((await iterator.next()).done).toBe(false);
      nodes[2].slot = 99;
      nodes[2].blockRoot = "mutated";
      expect((await iterator.next()).done).toBe(false);
      expect((await iterator.next()).done).toBe(true);
      expect(readColumns).toHaveBeenNthCalledWith(1, 2, originalRoots[0], [0]);
      expect(readColumns).toHaveBeenNthCalledWith(2, 4, originalRoots[1], [0]);
    } finally {
      await iterator.return?.();
    }
  });

  it("serves an available one-slot range more than 8192 ancestors behind the head", async () => {
    const {chain, db, read} = fixture(Array.from({length: 9001}, (_, index) => 9000 - index));
    const responses = await Array.fromAsync(
      onBeaconBlocksByRange({startSlot: 1, count: 1, step: 1}, chain, db, peer, "test")
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
    const iterator = onBeaconBlocksByRange({startSlot: 1, count: 4, step: 1}, chain, db, peer, "test")[
      Symbol.asyncIterator
    ]();
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

  it("keeps only requested ancestors above the archive boundary", () => {
    const {chain} = fixture([10, 8, 4, 2, 0]);
    expect(collectHeadRange(chain, 1, 5, 2).map(({slot}) => slot)).toEqual([4]);
    expect(collectHeadRange(chain, 5, 8, 0).map(({slot}) => slot)).toEqual([4]);
  });
});
