import {describe, expect, it} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {buildDataFillPlan} from "../../../../src/sync/target/dataFillPlan.js";
import {HeaderChain} from "../../../../src/sync/target/types.js";
import {config} from "../../../utils/blocksAndData.js";

// With MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS = 4096 (defaultChainConfig):
//   isDaOutOfRange returns true  when computeEpochAtSlot(slot) < currentEpoch - 4096
//   isDaOutOfRange returns false when computeEpochAtSlot(slot) >= currentEpoch - 4096
//
// We use currentEpoch = 5000:
//   - in-window boundary  = 5000 - 4096 = 904 epochs
//   - GLOAS_FORK_EPOCH = 40, so slots >= 40 * 32 = 1280 → forkName = gloas (post-fulu)
//   - inWindowSlot  at epoch 4100 (slot 4100 * 32 = 131200) → epoch 4100 >= 904 → in window
//   - outWindowSlot at epoch 0   (slot 0)                   → epoch 0    <  904 → out of window
//     (gloas check: slot 0 is pre-gloas, isForkPostFulu=false → falls to isForkPostDeneb check,
//      but slot 0 is also pre-deneb → isDaOutOfRange returns true unconditionally)

const CURRENT_EPOCH = 5000;
// Slots in the gloas era and within the DA availability window
const IN_WINDOW_BASE = 4100 * SLOTS_PER_EPOCH; // epoch 4100, well within window

describe("buildDataFillPlan", () => {
  it("classifies FULL/EMPTY edges and tip deferral correctly", () => {
    // 4-element chain (bottom → top = indices 0 → 3)
    //
    // el0: FULL   — el1.parentBlockHash === el0.blockHash; blobCount 2, in-window → needsEnvelope+needsColumns
    // el1: EMPTY  — el2.parentBlockHash !== el1.blockHash (skipped el1's payload); blobCount 0
    // el2: FULL   — el3.parentBlockHash === el2.blockHash; blobCount 0 → needsEnvelope only
    // el3: tip    — no child → needsEnvelope false (tip deferral)
    const headerChain: HeaderChain = [
      {
        root: "0xa0",
        parentRoot: "0xint",
        slot: IN_WINDOW_BASE,
        blockHash: "0xh0",
        parentBlockHash: "0xpInt",
        blobCount: 2,
      },
      {
        root: "0xa1",
        parentRoot: "0xa0",
        slot: IN_WINDOW_BASE + 1,
        blockHash: "0xh1",
        parentBlockHash: "0xh0", // child of el0 → el0 is FULL
        blobCount: 0,
      },
      {
        root: "0xa2",
        parentRoot: "0xa1",
        slot: IN_WINDOW_BASE + 2,
        blockHash: "0xh2",
        parentBlockHash: "0xpInt2", // skips el1's blockHash (0xh1) → el1 is EMPTY
        blobCount: 0,
      },
      {
        root: "0xa3",
        parentRoot: "0xa2",
        slot: IN_WINDOW_BASE + 3,
        blockHash: "0xh3",
        parentBlockHash: "0xh2", // child of el2 → el2 is FULL
        blobCount: 0,
      },
    ];

    const items = buildDataFillPlan(config, headerChain, CURRENT_EPOCH);
    expect(items).toHaveLength(4);

    // el0: FULL, blobCount 2, in-window → needsEnvelope + needsColumns
    expect(items.find((i) => i.root === "0xa0")).toMatchObject({
      needsEnvelope: true,
      needsColumns: true,
      blobCount: 2,
    });

    // el1: EMPTY (child skipped its blockHash) → neither
    expect(items.find((i) => i.root === "0xa1")).toMatchObject({
      needsEnvelope: false,
      needsColumns: false,
    });

    // el2: FULL, but blobCount 0 → needsEnvelope only, no columns
    expect(items.find((i) => i.root === "0xa2")).toMatchObject({
      needsEnvelope: true,
      needsColumns: false,
    });

    // el3: tip deferral — no child in chain → never needsEnvelope
    expect(items.find((i) => i.root === "0xa3")).toMatchObject({
      needsEnvelope: false,
    });
  });

  it("needsColumns is false when slot is outside the DA availability window", () => {
    // A 2-element chain where el0 is a FULL gloas block with blobs but its slot is below the DA
    // availability window. Epoch 100 is post-gloas (>= GLOAS_FORK_EPOCH 40) yet out of window
    // (100 < currentEpoch 5000 - 4096 = 904), so needsEnvelope stays true but needsColumns is false.
    const OUT_WINDOW_GLOAS = 100 * SLOTS_PER_EPOCH;
    const headerChain: HeaderChain = [
      {
        root: "0xold0",
        parentRoot: "0xoldInt",
        slot: OUT_WINDOW_GLOAS,
        blockHash: "0xoldH0",
        parentBlockHash: "0xoldPInt",
        blobCount: 3,
      },
      {
        root: "0xold1",
        parentRoot: "0xold0",
        slot: OUT_WINDOW_GLOAS + 1,
        blockHash: "0xoldH1",
        parentBlockHash: "0xoldH0", // child of el0 → el0 is FULL
        blobCount: 0,
      },
    ];

    const items = buildDataFillPlan(config, headerChain, CURRENT_EPOCH);

    // el0: FULL and blobCount > 0 but slot is pre-deneb → out of window → no columns
    expect(items.find((i) => i.root === "0xold0")).toMatchObject({
      needsEnvelope: true,
      needsColumns: false,
      blobCount: 3,
    });

    // el1: tip → needsEnvelope false
    expect(items.find((i) => i.root === "0xold1")).toMatchObject({
      needsEnvelope: false,
    });
  });
});
