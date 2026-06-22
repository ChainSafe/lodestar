import {PeerId} from "@libp2p/interface";
import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {ColumnIndex} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../../../src/chain/index.js";
import {ZERO_HASH} from "../../../../../src/constants/index.js";
import {IBeaconDb} from "../../../../../src/db/index.js";
import {onDataColumnSidecarsByRoot} from "../../../../../src/network/reqresp/handlers/dataColumnSidecarsByRoot.js";
import {DataColumnSidecarsByRootRequest} from "../../../../../src/util/types.js";

const config = createBeaconConfig(
  {
    ...chainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS: 1,
  },
  ZERO_HASH
);
const peerId = {toString: () => "test-peer"} as PeerId;

// Columns this node custodies. Identifiers requesting only non-custodied columns yield nothing.
const CUSTODY_COLUMNS: ColumnIndex[] = [1, 2];
const currentEpoch = 2;
const slot = computeStartSlotAtEpoch(currentEpoch);

const rootA = new Uint8Array(32).fill(0xaa);
const rootB = new Uint8Array(32).fill(0xbb);

/** Marker bytes for the held sidecar of (root, column) so responses can be asserted by identity. */
function sidecarBytes(rootHex: string, column: ColumnIndex): Uint8Array {
  return new Uint8Array([rootHex.charCodeAt(2), column]);
}

describe("onDataColumnSidecarsByRoot", () => {
  it("serves a later identifier after one whose columns do not overlap custody (no truncation)", async () => {
    const chain = createChain();
    const db = createDb();
    // root_A requests only column 0 (not custodied); root_B requests column 1 (custodied and held)
    const request: DataColumnSidecarsByRootRequest = [
      {blockRoot: rootA, columns: [0]},
      {blockRoot: rootB, columns: [1]},
    ];

    const responses = await Array.fromAsync(onDataColumnSidecarsByRoot(request, chain, db, peerId, "test-client"));

    expect(responses.map((r) => r.data)).toEqual([sidecarBytes(toRootHex(rootB), 1)]);
  });

  it("skips an identifier with an empty columns list instead of aborting the stream", async () => {
    const chain = createChain();
    const db = createDb();
    const request: DataColumnSidecarsByRootRequest = [
      {blockRoot: rootA, columns: []},
      {blockRoot: rootB, columns: [1]},
    ];

    const responses = await Array.fromAsync(onDataColumnSidecarsByRoot(request, chain, db, peerId, "test-client"));

    expect(responses.map((r) => r.data)).toEqual([sidecarBytes(toRootHex(rootB), 1)]);
  });

  it("serves custodied columns across all identifiers", async () => {
    const chain = createChain();
    const db = createDb();
    const request: DataColumnSidecarsByRootRequest = [
      {blockRoot: rootA, columns: [1]},
      {blockRoot: rootB, columns: [2]},
    ];

    const responses = await Array.fromAsync(onDataColumnSidecarsByRoot(request, chain, db, peerId, "test-client"));

    expect(responses.map((r) => r.data)).toEqual([
      sidecarBytes(toRootHex(rootA), 1),
      sidecarBytes(toRootHex(rootB), 2),
    ]);
  });
});

function createChain(): IBeaconChain {
  const custodyColumnsIndex = new Uint8Array(NUMBER_OF_COLUMNS);
  for (const c of CUSTODY_COLUMNS) {
    custodyColumnsIndex[c] = 1;
  }

  return {
    config,
    clock: {currentEpoch},
    earliestAvailableSlot: 0,
    custodyConfig: {custodyColumns: CUSTODY_COLUMNS, custodyColumnsIndex},
    forkChoice: {
      getBlockHexDefaultStatus: vi.fn(() => ({slot})),
    },
    // Returns held sidecar bytes aligned to the requested (available) columns. Every custodied
    // column is held here, so the unavailability path is never exercised.
    getSerializedDataColumnSidecars: vi.fn(async (_slot: number, blockRootHex: string, columns: ColumnIndex[]) =>
      columns.map((c) => sidecarBytes(blockRootHex, c))
    ),
    logger: {verbose: vi.fn()},
  } as unknown as IBeaconChain;
}

function createDb(): IBeaconDb {
  return {
    blockArchive: {getSlotByRoot: vi.fn(async () => null)},
  } as unknown as IBeaconDb;
}
