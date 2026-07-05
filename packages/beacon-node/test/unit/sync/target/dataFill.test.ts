import {Mock, beforeEach, describe, expect, it, vi} from "vitest";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ColumnIndex, fulu, ssz} from "@lodestar/types";
import {DataFillDeps, dataFill} from "../../../../src/sync/target/dataFill.js";
import {DataFillItem} from "../../../../src/sync/target/dataFillPlan.js";
import * as fetchEnvelopeByRoot from "../../../../src/sync/target/fetchEnvelopeByRoot.js";
import * as downloadByRoot from "../../../../src/sync/utils/downloadByRoot.js";
import {config, generateBlock} from "../../../utils/blocksAndData.js";

// Sampled columns the local node requires (small set keeps the custody math readable).
const SAMPLED_COLUMNS: ColumnIndex[] = [0, 1, 2];

const SERVING_PEER = "peer-serving";
const COLUMN_PEER = "peer-columns";

/** A fake PayloadEnvelopeInput exposing only the methods the executor touches. */
type FakePayloadInput = {
  hasColumn: Mock;
  addColumn: Mock;
  hasComputedAllData: Mock;
  hasPayloadEnvelope: Mock;
};

/**
 * `columnsComplete` marks the column gate done at construction (blobCount-0 / out-of-window
 * items). Otherwise the gate derives from real admission: `addColumn` accumulates indices and
 * `hasComputedAllData` flips only once every sampled column has actually been admitted — so a
 * `filled` assertion genuinely checks the executor admitted them, rather than a hard-coded flag.
 * `hasEnvelope` controls the envelope gate (`hasPayloadEnvelope`); cases that never admit the
 * envelope must report `false`.
 */
function makePayloadInput(opts?: {columnsComplete?: boolean; hasEnvelope?: boolean}): FakePayloadInput {
  const admitted = new Set<ColumnIndex>();
  return {
    hasColumn: vi.fn((index: ColumnIndex) => admitted.has(index)),
    addColumn: vi.fn((props: {columnSidecar: {index: ColumnIndex}}) => {
      admitted.add(props.columnSidecar.index);
    }),
    hasComputedAllData: vi.fn(() => opts?.columnsComplete === true || SAMPLED_COLUMNS.every((i) => admitted.has(i))),
    hasPayloadEnvelope: vi.fn().mockReturnValue(opts?.hasEnvelope ?? false),
  };
}

function makeColumnSidecar(index: ColumnIndex): fulu.DataColumnSidecar {
  const sidecar = ssz.fulu.DataColumnSidecar.defaultValue();
  sidecar.index = index;
  return sidecar;
}

/** Build a full DataFillDeps stub plus the shared mocks used to assert on its behavior. */
function buildDeps(opts: {
  payloadInput: FakePayloadInput;
  peers: string[];
  // peerId -> columns it custodies; absent peers custody nothing.
  custodyByPeer?: Map<string, ColumnIndex[]>;
  connectedPeers?: string[];
}): {
  deps: DataFillDeps;
  reportPeer: Mock;
  storeGet: Mock;
  getConnectedPeerSyncMeta: Mock;
  seenAdd: Mock;
} {
  const {block} = generateBlock({forkName: ForkName.gloas});

  const reportPeer = vi.fn();
  const storeGet = vi.fn().mockResolvedValue(block);

  const custodyByPeer = opts.custodyByPeer ?? new Map<string, ColumnIndex[]>();
  const getConnectedPeerSyncMeta = vi.fn().mockImplementation((peerId: string) => ({
    peerId,
    client: "lodestar",
    custodyColumns: custodyByPeer.get(peerId) ?? [],
  }));

  // dataFill uses get-or-create `add` only (the `get(...) ?? add(...)` was collapsed).
  const seenAdd = vi.fn().mockReturnValue(opts.payloadInput);

  const chain = {
    config,
    custodyConfig: {sampledColumns: SAMPLED_COLUMNS},
    seenPayloadEnvelopeInputCache: {add: seenAdd},
    logger: {debug: vi.fn(), warn: vi.fn()},
    metrics: {targetSync: {dataFillUnexpectedErrorTotal: {inc: vi.fn()}}},
  } as unknown as DataFillDeps["chain"];

  const network = {
    getConnectedPeers: vi.fn().mockReturnValue(opts.connectedPeers ?? []),
    getConnectedPeerSyncMeta,
  } as unknown as DataFillDeps["network"];

  const deps: DataFillDeps = {
    config,
    chain,
    network,
    store: {get: storeGet},
    peers: new Set(opts.peers),
    reportPeer,
  };

  return {deps, reportPeer, storeGet, getConnectedPeerSyncMeta, seenAdd};
}

function envelopeItem(overrides?: Partial<DataFillItem>): DataFillItem {
  return {
    root: "0xenvelope",
    slot: SLOTS_PER_EPOCH * 999,
    forkName: ForkName.gloas,
    needsEnvelope: true,
    needsColumns: false,
    blobCount: 0,
    ...overrides,
  };
}

describe("dataFill", () => {
  let envelopeSpy: Mock;
  let columnsSpy: Mock;

  beforeEach(() => {
    envelopeSpy = vi
      .spyOn(fetchEnvelopeByRoot, "fetchAndValidateExecutionPayloadEnvelopeByRoot")
      .mockResolvedValue({result: "ADMITTED", warnings: null}) as unknown as Mock;
    columnsSpy = vi
      .spyOn(downloadByRoot, "fetchAndValidateColumns")
      .mockResolvedValue({result: [], warnings: null}) as unknown as Mock;
  });

  it("envelope-only item: fetches+admits the envelope, no column fetch, counts filled", async () => {
    const payloadInput = makePayloadInput({columnsComplete: true, hasEnvelope: true});
    const {deps} = buildDeps({payloadInput, peers: [SERVING_PEER]});

    const {filled, deferred} = await dataFill([envelopeItem()], deps);

    expect(envelopeSpy).toHaveBeenCalledOnce();
    expect(columnsSpy).not.toHaveBeenCalled();
    expect(filled).toBe(1);
    expect(deferred).toBe(0);
  });

  it("envelope+columns item: fetches both, admits columns, counts filled on hasComputedAllData", async () => {
    // Columns are NOT pre-complete: the executor must admit all SAMPLED_COLUMNS for the gate to pass.
    const payloadInput = makePayloadInput({hasEnvelope: true});
    const custodyByPeer = new Map([[COLUMN_PEER, SAMPLED_COLUMNS]]);
    const {deps} = buildDeps({
      payloadInput,
      peers: [SERVING_PEER, COLUMN_PEER],
      custodyByPeer,
      connectedPeers: [SERVING_PEER, COLUMN_PEER],
    });

    columnsSpy.mockResolvedValue({result: SAMPLED_COLUMNS.map(makeColumnSidecar), warnings: null});

    const item = envelopeItem({root: "0xboth", needsColumns: true, blobCount: 3});
    const {filled, deferred} = await dataFill([item], deps);

    expect(envelopeSpy).toHaveBeenCalledOnce();
    expect(columnsSpy).toHaveBeenCalledOnce();
    expect(payloadInput.addColumn).toHaveBeenCalledTimes(SAMPLED_COLUMNS.length);
    expect(filled).toBe(1);
    expect(deferred).toBe(0);
  });

  it("EMPTY item (needsEnvelope:false, needsColumns:false): issues no fetch", async () => {
    const payloadInput = makePayloadInput();
    const {deps, storeGet} = buildDeps({payloadInput, peers: [SERVING_PEER]});

    const item = envelopeItem({root: "0xempty", needsEnvelope: false, needsColumns: false});
    const {filled, deferred} = await dataFill([item], deps);

    expect(storeGet).not.toHaveBeenCalled();
    expect(envelopeSpy).not.toHaveBeenCalled();
    expect(columnsSpy).not.toHaveBeenCalled();
    expect(filled).toBe(0);
    expect(deferred).toBe(0);
  });

  it("custody miss: no peer custodies a needed column and global fallback empty → no-op, item deferred", async () => {
    const payloadInput = makePayloadInput();
    // Neither the proven holders nor the global fallback custody any sampled column.
    const {deps, reportPeer} = buildDeps({
      payloadInput,
      peers: [COLUMN_PEER],
      custodyByPeer: new Map(),
      connectedPeers: [],
    });

    const item = envelopeItem({root: "0xmiss", needsEnvelope: false, needsColumns: true, blobCount: 3});
    const {filled, deferred} = await dataFill([item], deps);

    expect(columnsSpy).not.toHaveBeenCalled();
    expect(reportPeer).not.toHaveBeenCalled();
    expect(filled).toBe(0);
    expect(deferred).toBe(1);
  });

  it("rejected envelope: reportPeer called for the serving peer", async () => {
    const payloadInput = makePayloadInput({columnsComplete: true});
    const {deps, reportPeer} = buildDeps({payloadInput, peers: [SERVING_PEER]});

    envelopeSpy.mockResolvedValue({
      result: "REJECTED",
      warnings: [
        new downloadByRoot.DownloadByRootError({
          code: downloadByRoot.DownloadByRootErrorCode.ENVELOPE_REJECTED,
          peer: SERVING_PEER,
          blockRoot: "0xenvelope",
        }),
      ],
    });

    const {filled, deferred} = await dataFill([envelopeItem()], deps);

    expect(reportPeer).toHaveBeenCalledOnce();
    expect(reportPeer).toHaveBeenCalledWith(SERVING_PEER, "ENVELOPE_REJECTED");
    expect(filled).toBe(0);
    expect(deferred).toBe(1);
  });

  it("needsEnvelope item whose envelope is never admitted (no peers): deferred, not filled", async () => {
    // blobCount 0 → hasComputedAllData() is true at construction (the column gate passes), but
    // the envelope was never admitted (no proven holders to fetch from). The item must be
    // counted `deferred`, not `filled` — regression for the `filled` over-count.
    const payloadInput = makePayloadInput({columnsComplete: true, hasEnvelope: false});
    const {deps} = buildDeps({payloadInput, peers: []});

    const {filled, deferred} = await dataFill([envelopeItem()], deps);

    expect(envelopeSpy).not.toHaveBeenCalled();
    expect(filled).toBe(0);
    expect(deferred).toBe(1);
  });

  it("needsEnvelope item whose envelope fetch PEER_MISSes: deferred, not filled", async () => {
    // Same over-count regression, but with a proven holder present that returns PEER_MISS, so
    // the envelope is fetched yet never admitted. `hasComputedAllData()` is true (blobCount 0)
    // but `hasPayloadEnvelope()` is false → deferred, not filled.
    const payloadInput = makePayloadInput({columnsComplete: true, hasEnvelope: false});
    const {deps, reportPeer} = buildDeps({payloadInput, peers: [SERVING_PEER]});

    envelopeSpy.mockResolvedValue({result: "PEER_MISS", warnings: null});

    const {filled, deferred} = await dataFill([envelopeItem()], deps);

    expect(envelopeSpy).toHaveBeenCalledOnce();
    expect(reportPeer).not.toHaveBeenCalled();
    expect(filled).toBe(0);
    expect(deferred).toBe(1);
  });

  it("disconnected proven holder: getConnectedPeerSyncMeta throws → no throw, falls back, pass completes", async () => {
    // A proven holder in deps.peers that is no longer connected. getConnectedPeerSyncMeta throws
    // for it (mirrors network.ts). dataFill must not propagate the throw — it skips/falls back and
    // completes the pass. Here the fallback (a connected peer) custodies the needed columns.
    // Columns are admitted via the fallback peer, so the gate derives from real admission.
    const payloadInput = makePayloadInput();
    const custodyByPeer = new Map([[COLUMN_PEER, SAMPLED_COLUMNS]]);
    const {deps, getConnectedPeerSyncMeta} = buildDeps({
      payloadInput,
      peers: [SERVING_PEER],
      custodyByPeer,
      // SERVING_PEER (a proven holder) is NOT in the connected set; COLUMN_PEER is the fallback.
      connectedPeers: [COLUMN_PEER],
    });

    // Throw if anyone calls getConnectedPeerSyncMeta on the disconnected proven holder.
    getConnectedPeerSyncMeta.mockImplementation((peerId: string) => {
      if (peerId === SERVING_PEER) {
        throw new Error(`peerId=${peerId} not in connectedPeerSyncMeta`);
      }
      return {peerId, client: "lodestar", custodyColumns: custodyByPeer.get(peerId) ?? []};
    });

    columnsSpy.mockResolvedValue({result: SAMPLED_COLUMNS.map(makeColumnSidecar), warnings: null});

    const item = envelopeItem({root: "0xstaler", needsEnvelope: false, needsColumns: true, blobCount: 3});

    // Must not throw.
    const {filled, deferred} = await dataFill([item], deps);

    // Column fetch reached the fallback peer; pass completed (item filled — no envelope needed).
    expect(columnsSpy).toHaveBeenCalledOnce();
    expect(filled).toBe(1);
    expect(deferred).toBe(0);
  });

  it("a typed by-root fetch fault defers the item quietly instead of aborting the slice", async () => {
    const payloadInput = makePayloadInput({hasEnvelope: false});
    const custodyByPeer = new Map([[COLUMN_PEER, SAMPLED_COLUMNS]]);
    const {deps} = buildDeps({
      payloadInput,
      peers: [SERVING_PEER, COLUMN_PEER],
      custodyByPeer,
      connectedPeers: [SERVING_PEER, COLUMN_PEER],
    });
    // A peer that advertised custody returns nothing → the column fetcher throws a TYPED fetch fault.
    columnsSpy.mockRejectedValue(
      new downloadByRoot.DownloadByRootError({
        code: downloadByRoot.DownloadByRootErrorCode.NO_SIDECAR_RECEIVED,
        peer: COLUMN_PEER,
        slot: 0,
        blockRoot: "0xthrow",
      })
    );

    const item = envelopeItem({root: "0xdead", needsEnvelope: false, needsColumns: true, blobCount: 3});
    // Must not throw — the fault is contained to a deferral, logged at debug (expected), not metered.
    const {filled, deferred} = await dataFill([item], deps);

    expect(filled).toBe(0);
    expect(deferred).toBe(1);
    expect(deps.chain.logger.warn as Mock).not.toHaveBeenCalled();
  });

  it("an unexpected (non-fetch) error still defers but is surfaced + metered", async () => {
    const payloadInput = makePayloadInput({hasEnvelope: false});
    const custodyByPeer = new Map([[COLUMN_PEER, SAMPLED_COLUMNS]]);
    const {deps} = buildDeps({
      payloadInput,
      peers: [SERVING_PEER, COLUMN_PEER],
      custodyByPeer,
      connectedPeers: [SERVING_PEER, COLUMN_PEER],
    });
    // A plain Error (e.g. an invariant/programming bug) is NOT an expected fetch fault.
    columnsSpy.mockRejectedValue(new Error("unexpected invariant"));

    const item = envelopeItem({root: "0xbeef", needsEnvelope: false, needsColumns: true, blobCount: 3});
    const {filled, deferred} = await dataFill([item], deps);

    // Still deferred (one bad item must not kill the chain), but surfaced loudly + metered.
    expect(filled).toBe(0);
    expect(deferred).toBe(1);
    expect(deps.chain.logger.warn as Mock).toHaveBeenCalledOnce();
    const metrics = deps.chain.metrics as unknown as {targetSync: {dataFillUnexpectedErrorTotal: {inc: Mock}}};
    expect(metrics.targetSync.dataFillUnexpectedErrorTotal.inc).toHaveBeenCalledOnce();
  });
});
