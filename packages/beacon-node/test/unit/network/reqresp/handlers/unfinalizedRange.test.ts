import assert from "node:assert/strict";
import {PeerId} from "@libp2p/interface";
import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {ExecutionStatus, PayloadStatus, ProtoArray, ProtoBlock} from "@lodestar/fork-choice";
import {NUMBER_OF_COLUMNS, SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {fromHex, toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../../../src/chain/interface.js";
import {IBeaconDb} from "../../../../../src/db/interface.js";
import {
  collectHeadRange,
  onBeaconBlocksByRange,
} from "../../../../../src/network/reqresp/handlers/beaconBlocksByRange.js";
import {onDataColumnSidecarsByRange} from "../../../../../src/network/reqresp/handlers/dataColumnSidecarsByRange.js";

const config = createBeaconConfig({FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 1}, new Uint8Array(32));
const peer = {toString: () => "peer"} as PeerId;

function root(value: number): string {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(0, value);
  return toRootHex(bytes);
}

function block(
  slot: number,
  parent: Pick<ProtoBlock, "blockRoot" | "executionPayloadBlockHash">,
  gloas = false,
  branch = 0
): ProtoBlock {
  assert(parent.executionPayloadBlockHash !== null);
  return {
    slot,
    blockRoot: root(slot + branch),
    parentRoot: parent.blockRoot,
    stateRoot: root(0),
    targetRoot: root(0),
    justifiedEpoch: 0,
    justifiedRoot: root(0),
    finalizedEpoch: 0,
    finalizedRoot: root(0),
    unrealizedJustifiedEpoch: 0,
    unrealizedJustifiedRoot: root(0),
    unrealizedFinalizedEpoch: 0,
    unrealizedFinalizedRoot: root(0),
    timeliness: true,
    importedTimely: true,
    ptcTimeliness: true,
    proposerIndex: 0,
    executionPayloadBlockHash: gloas ? parent.executionPayloadBlockHash : root(slot),
    executionPayloadNumber: slot,
    executionPayloadGasLimit: 30_000_000,
    executionStatus: ExecutionStatus.Valid,
    dataAvailabilityStatus: DataAvailabilityStatus.Available,
    parentBlockHash: gloas ? parent.executionPayloadBlockHash : null,
    payloadStatus: gloas ? PayloadStatus.PENDING : PayloadStatus.FULL,
  };
}

function fixture(slots: number[], gloas = false) {
  const anchor = block(0, {blockRoot: root(0), executionPayloadBlockHash: root(0)});
  const protoArray = ProtoArray.initialize(anchor, 0);
  let head = anchor;
  const revealPayload = (slot: number): void => {
    protoArray.onExecutionPayload(
      root(slot),
      slots[0],
      root(slot + 100_000),
      slot,
      30_000_000,
      null,
      ExecutionStatus.Valid,
      DataAvailabilityStatus.Available
    );
  };
  for (const slot of slots.toReversed()) {
    if (slot === 0) continue;
    const next = block(slot, head, gloas);
    protoArray.onBlock(next, slots[0], null);
    // Gloas children extend FULL, EMPTY, then FULL; leave the head PENDING.
    const status =
      gloas && slot === slots[0]
        ? PayloadStatus.PENDING
        : gloas && slot === slots[2]
          ? PayloadStatus.EMPTY
          : PayloadStatus.FULL;
    if (gloas && status === PayloadStatus.FULL) revealPayload(slot);
    const node = protoArray.getBlock(next.blockRoot, status);
    assert(node);
    head = node;
  }
  const read = vi.fn(async (blockRoot: string) => ({block: fromHex(blockRoot)}));
  const readColumns = vi.fn(async () => [new Uint8Array(1)]);
  const chain = {
    config,
    earliestAvailableSlot: 0,
    clock: {currentEpoch: 1},
    custodyConfig: {custodyColumnsIndex: new Uint8Array(NUMBER_OF_COLUMNS).fill(1)},
    forkChoice: {
      getHead: () => head,
      getFinalizedCheckpointSlot: () => 0,
      getFinalizedBlock: () => anchor,
      // Same delegation as ForkChoice; the real ProtoArray selects EMPTY/FULL ancestors.
      iterateAncestorBlocks: protoArray.iterateAncestorNodes.bind(protoArray),
      getAllAncestorBlocks: vi.fn(protoArray.getAllAncestorNodes.bind(protoArray)),
    },
    getSerializedBlockByRoot: read,
    getSerializedDataColumnSidecars: readColumns,
  } as unknown as IBeaconChain;
  const db = {} as unknown as IBeaconDb;
  const reorg = (): void => {
    const replacement = block(slots[0], anchor, gloas, 1_000_000);
    protoArray.onBlock(replacement, slots[0], null);
    const node = protoArray.getBlock(replacement.blockRoot, gloas ? PayloadStatus.PENDING : PayloadStatus.FULL);
    assert(node);
    head = node;
  };
  return {chain, db, protoArray, read, readColumns, revealPayload, reorg};
}

const gloasSlots = [10, 8, 4, 2].map((slot) => SLOTS_PER_EPOCH + slot);

describe("unfinalized serving range", () => {
  it("serves an available one-slot range more than 8192 ancestors behind the head", async () => {
    const {chain, db, read} = fixture(Array.from({length: 9001}, (_, index) => 9000 - index));
    const responses = await Array.fromAsync(
      onBeaconBlocksByRange({startSlot: 1, count: 1, step: 1}, chain, db, peer, "test")
    );
    expect(responses).toHaveLength(1);
    expect(read).toHaveBeenCalledExactlyOnceWith(root(1));
    expect(new DataView(responses[0].data.buffer, responses[0].data.byteOffset).getUint32(0)).toBe(1);
    expect(chain.forkChoice.getAllAncestorBlocks).not.toHaveBeenCalled();
  });

  it("keeps sparse requested blocks consistent across a reorg between reads", async () => {
    const {chain, db, read, reorg} = fixture([10, 8, 4, 2, 0]);
    const iterator = onBeaconBlocksByRange({startSlot: 1, count: 4, step: 1}, chain, db, peer, "test")[
      Symbol.asyncIterator
    ]();
    try {
      expect((await iterator.next()).done).toBe(false);
      reorg();
      expect((await iterator.next()).done).toBe(false);
      expect((await iterator.next()).done).toBe(true);
      expect(read.mock.calls.map(([blockRoot]) => blockRoot)).toEqual([root(2), root(4)]);
    } finally {
      await iterator.return?.();
    }
  });

  it("keeps only requested ancestors above the archive boundary and one predecessor", () => {
    const {chain} = fixture([10, 8, 4, 2, 0]);
    expect(collectHeadRange(chain, 1, 5, 2)).toEqual([
      {slot: 4, blockRoot: root(4), payloadStatus: PayloadStatus.FULL},
    ]);
    expect(collectHeadRange(chain, 5, 8, 0)).toEqual([
      {slot: 4, blockRoot: root(4), payloadStatus: PayloadStatus.FULL},
    ]);
  });

  it("bounds the finalized archive by slots without a redundant entry limit", async () => {
    const {chain} = fixture([10, 4, 0]);
    chain.forkChoice.getFinalizedCheckpointSlot = () => 4;
    const binaryEntriesStream = vi.fn(async function* () {});
    const db = {blockArchive: {binaryEntriesStream}} as unknown as IBeaconDb;
    await Array.fromAsync(onBeaconBlocksByRange({startSlot: 1, count: 4, step: 1}, chain, db, peer, "test"));
    expect(binaryEntriesStream).toHaveBeenCalledExactlyOnceWith({gte: 1, lt: 5});
  });

  it("serves columns only for canonical FULL parents despite late payloads and a reorg", async () => {
    const {chain, db, readColumns, revealPayload, reorg} = fixture(gloasSlots, true);
    const iterator = onDataColumnSidecarsByRange(
      {startSlot: SLOTS_PER_EPOCH + 1, count: 10, columns: [0]},
      chain,
      db,
      peer,
      "test"
    )[Symbol.asyncIterator]();
    try {
      expect((await iterator.next()).done).toBe(false);
      // Add real FULL siblings; neither changes the variant selected by the original head.
      revealPayload(gloasSlots[2]);
      revealPayload(gloasSlots[0]);
      reorg();
      expect((await iterator.next()).done).toBe(false);
      expect((await iterator.next()).done).toBe(true);
      expect(readColumns.mock.calls).toEqual([
        [gloasSlots[3], root(gloasSlots[3]), [0]],
        [gloasSlots[1], root(gloasSlots[1]), [0]],
      ]);
    } finally {
      await iterator.return?.();
    }
  });
  it("serves a PENDING Gloas head and its FULL/EMPTY ancestors once in slot order", async () => {
    const {chain, db, read} = fixture(gloasSlots, true);
    const responses = await Array.fromAsync(
      onBeaconBlocksByRange({startSlot: SLOTS_PER_EPOCH + 1, count: 10, step: 1}, chain, db, peer, "test")
    );
    expect(responses.map(({data}) => new DataView(data.buffer, data.byteOffset).getUint32(0))).toEqual(
      gloasSlots.toReversed()
    );
    expect(read.mock.calls.map(([blockRoot]) => blockRoot)).toEqual(gloasSlots.toReversed().map(root));
    expect(
      collectHeadRange(chain, SLOTS_PER_EPOCH + 1, SLOTS_PER_EPOCH + 11, 0).map(({payloadStatus}) => payloadStatus)
    ).toEqual([PayloadStatus.FULL, PayloadStatus.EMPTY, PayloadStatus.FULL, PayloadStatus.PENDING]);
  });
});
