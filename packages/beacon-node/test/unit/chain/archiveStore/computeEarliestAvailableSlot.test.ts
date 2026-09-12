import {beforeEach, describe, expect, it, vi} from "vitest";
import {Slot} from "@lodestar/types";
import {computeEarliestAvailableSlot} from "../../../../src/chain/archiveStore/utils/computeEarliestAvailableSlot.js";
import {MockedBeaconDb, getMockedBeaconDb} from "../../../mocks/mockedBeaconDb.js";

// `backfilledRanges` entries map an upper slot back to the lower slot it is contiguous down to.
type Range = {key: Slot; value: Slot};

function setDb(db: MockedBeaconDb, {ranges, blob, column}: {ranges?: Range[]; blob?: Slot; column?: Slot}): void {
  db.backfilledRanges.entries = vi.fn<() => Promise<Range[]>>().mockResolvedValue(ranges ?? []);
  db.blobSidecarsArchive.firstKey = vi.fn<() => Promise<Slot | null>>().mockResolvedValue(blob ?? null);
  db.dataColumnSidecarArchive.keys = vi
    .fn<() => Promise<{prefix: Slot; id: number}[]>>()
    .mockResolvedValue(column == null ? [] : [{prefix: column, id: 0}]);
}

describe("computeEarliestAvailableSlot", () => {
  const anchorSlot = 1000;
  let db: MockedBeaconDb;

  beforeEach(() => {
    db = getMockedBeaconDb();
    setDb(db, {});
  });

  it("returns the anchor slot when nothing else is retained", async () => {
    expect(await computeEarliestAvailableSlot(db, anchorSlot)).toBe(anchorSlot);
  });

  it("lowers to the original anchor when a range connects it contiguously to head", async () => {
    // Node checkpoint-synced at slot 100 and forward-synced; restart re-anchors at 1000.
    setDb(db, {ranges: [{key: 1000, value: 100}]});
    expect(await computeEarliestAvailableSlot(db, anchorSlot)).toBe(100);
  });

  it("walks multiple abutting ranges down to the deepest contiguous slot", async () => {
    setDb(db, {
      ranges: [
        {key: 1000, value: 500}, // forward range [500, 1000]
        {key: 500, value: 100}, // backfilled range [100, 500]
      ],
    });
    expect(await computeEarliestAvailableSlot(db, anchorSlot)).toBe(100);
  });

  it("does NOT advertise below a gap (stale data not connected to head)", async () => {
    // Node had old data [0, 200] then checkpoint-synced ahead to 1000: hole [200, 1000].
    setDb(db, {ranges: [{key: 200, value: 0}]});
    expect(await computeEarliestAvailableSlot(db, anchorSlot)).toBe(anchorSlot);
  });

  it("raises the bound to the oldest retained custody column slot", async () => {
    setDb(db, {ranges: [{key: 1000, value: 100}], column: 500});
    expect(await computeEarliestAvailableSlot(db, anchorSlot)).toBe(500);
  });

  it("takes the most restrictive (highest) lower bound across blocks, blobs and columns", async () => {
    setDb(db, {ranges: [{key: 1000, value: 100}], blob: 700, column: 500});
    expect(await computeEarliestAvailableSlot(db, anchorSlot)).toBe(700);
  });

  it("ignores sidecar bounds below the contiguous block slot", async () => {
    setDb(db, {ranges: [{key: 1000, value: 800}], blob: 300, column: 400});
    expect(await computeEarliestAvailableSlot(db, anchorSlot)).toBe(800);
  });
});
