import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";

type LayersTest = {
  title: string;
  slot: Slot;
  path: Slot[];
  blockReplay?: {
    fromSlot?: Slot;
    tillSlot?: Slot;
  };
};

export const mixEpochLayers = "1,2,3,5";
export const mixEpochLayersData: LayersTest[] = [
  {
    title: "genesis slot (snapshot layer)",
    slot: computeStartSlotAtEpoch(0),
    path: [computeStartSlotAtEpoch(0)],
  },
  {
    title: "epoch 1 (1-epoch diff layer)",
    slot: computeStartSlotAtEpoch(1),
    path: [computeStartSlotAtEpoch(0), computeStartSlotAtEpoch(1)],
  },
  {
    title: "epoch 2 (1-epoch and 2-epoch diff layers align)",
    slot: computeStartSlotAtEpoch(2),
    path: [computeStartSlotAtEpoch(0), computeStartSlotAtEpoch(2)],
  },
  {
    title: "epoch 3 (1-epoch and 3-epoch diff layers align)",
    slot: computeStartSlotAtEpoch(3),
    path: [computeStartSlotAtEpoch(0), computeStartSlotAtEpoch(3)],
  },
  {
    title: "epoch 4 (1-epoch and 2-epoch diff layers)",
    slot: computeStartSlotAtEpoch(4),
    path: [computeStartSlotAtEpoch(0), computeStartSlotAtEpoch(3), computeStartSlotAtEpoch(4)],
  },
  {
    title: "epoch 5 (snapshot boundary)",
    slot: computeStartSlotAtEpoch(5),
    path: [computeStartSlotAtEpoch(5)],
  },
  {
    title: "epoch 6 (1-epoch and 2-epoch and 3-epoch diff layers align)",
    slot: computeStartSlotAtEpoch(6),
    path: [computeStartSlotAtEpoch(5), computeStartSlotAtEpoch(6)],
  },
  {
    title: "epoch 7 (1-epoch diff layer only)",
    slot: computeStartSlotAtEpoch(7),
    path: [computeStartSlotAtEpoch(5), computeStartSlotAtEpoch(6), computeStartSlotAtEpoch(7)],
  },
  {
    title: "epoch 8 (1-epoch and 2-epoch diff layers)",
    slot: computeStartSlotAtEpoch(8),
    path: [computeStartSlotAtEpoch(5), computeStartSlotAtEpoch(6), computeStartSlotAtEpoch(8)],
  },
  {
    title: "epoch 9 (1-epoch and 3-epoch diff layers)",
    slot: computeStartSlotAtEpoch(9),
    path: [computeStartSlotAtEpoch(5), computeStartSlotAtEpoch(9)],
  },
  {
    title: "epoch 10 (snapshot boundary)",
    slot: computeStartSlotAtEpoch(10),
    path: [computeStartSlotAtEpoch(10)],
  },
  {
    title: "epoch 11 (1-epoch diff layer)",
    slot: computeStartSlotAtEpoch(11),
    path: [computeStartSlotAtEpoch(10), computeStartSlotAtEpoch(11)],
  },
  {
    title: "epoch 12 (all diff layers align)",
    slot: computeStartSlotAtEpoch(12),
    path: [computeStartSlotAtEpoch(10), computeStartSlotAtEpoch(12)],
  },
  {
    title: "epoch 13 (1-epoch diff layer)",
    slot: computeStartSlotAtEpoch(13),
    path: [computeStartSlotAtEpoch(10), computeStartSlotAtEpoch(12), computeStartSlotAtEpoch(13)],
  },
  {
    title: "epoch 14 (1-epoch and 2-epoch diff layers)",
    slot: computeStartSlotAtEpoch(14),
    path: [computeStartSlotAtEpoch(10), computeStartSlotAtEpoch(12), computeStartSlotAtEpoch(14)],
  },
  {
    title: "epoch 15 (snapshot boundary)",
    slot: computeStartSlotAtEpoch(15),
    path: [computeStartSlotAtEpoch(15)],
  },
  {
    title: "epoch 16 (1-epoch and 2-epoch diff layers)",
    slot: computeStartSlotAtEpoch(16),
    path: [computeStartSlotAtEpoch(15), computeStartSlotAtEpoch(16)],
  },
  {
    title: "epoch 17 (1-epoch diff layer)",
    slot: computeStartSlotAtEpoch(17),
    path: [computeStartSlotAtEpoch(15), computeStartSlotAtEpoch(16), computeStartSlotAtEpoch(17)],
  },
  {
    title: "epoch 18 (all diff layers align)",
    slot: computeStartSlotAtEpoch(18),
    path: [computeStartSlotAtEpoch(15), computeStartSlotAtEpoch(18)],
  },
  {
    title: "epoch 20 (snapshot boundary)",
    slot: computeStartSlotAtEpoch(20),
    path: [computeStartSlotAtEpoch(20)],
  },
  {
    title: "epoch 23 (1-epoch diff layer)",
    slot: computeStartSlotAtEpoch(23),
    path: [
      computeStartSlotAtEpoch(20),
      computeStartSlotAtEpoch(21),
      computeStartSlotAtEpoch(22),
      computeStartSlotAtEpoch(23),
    ],
  },
  {
    title: "epoch 24 (all diff layers align)",
    slot: computeStartSlotAtEpoch(24),
    path: [computeStartSlotAtEpoch(20), computeStartSlotAtEpoch(24)],
  },
  {
    title: "epoch 25 (snapshot boundary)",
    slot: computeStartSlotAtEpoch(25),
    path: [computeStartSlotAtEpoch(25)],
  },
  {
    title: "epoch 30 (large alignment - all layers)",
    slot: computeStartSlotAtEpoch(30),
    path: [computeStartSlotAtEpoch(30)],
  },
  {
    title: "edge case: mid-slot within epoch first and second layer",
    slot: computeStartSlotAtEpoch(2) + 15,
    path: [computeStartSlotAtEpoch(0), computeStartSlotAtEpoch(2)],
    blockReplay: {
      fromSlot: computeStartSlotAtEpoch(2) + 1,
      tillSlot: computeStartSlotAtEpoch(2) + 15,
    },
  },
  {
    title: "edge case: last slot of epoch 4 (twice diff slot at layer 2)",
    slot: computeStartSlotAtEpoch(5) - 1,
    path: [computeStartSlotAtEpoch(0), computeStartSlotAtEpoch(3), computeStartSlotAtEpoch(4)],
    blockReplay: {
      fromSlot: computeStartSlotAtEpoch(4) + 1,
      tillSlot: computeStartSlotAtEpoch(5) - 1,
    },
  },
  {
    title: "edge case: mid-slot within epoch 7 (boundary of layer 3 and layer 1)",
    slot: computeStartSlotAtEpoch(7) + 10,
    path: [computeStartSlotAtEpoch(5), computeStartSlotAtEpoch(6), computeStartSlotAtEpoch(7)],
    blockReplay: {
      fromSlot: computeStartSlotAtEpoch(7) + 1,
      tillSlot: computeStartSlotAtEpoch(7) + 10,
    },
  },
  {
    title: "edge case: just before snapshot at epoch 10",
    slot: computeStartSlotAtEpoch(10) - 1,
    path: [computeStartSlotAtEpoch(5), computeStartSlotAtEpoch(9)],
    blockReplay: {
      fromSlot: computeStartSlotAtEpoch(9) + 1,
      tillSlot: computeStartSlotAtEpoch(10) - 1,
    },
  },
  {
    title: "edge case: large epoch beyond multiple snapshots",
    slot: computeStartSlotAtEpoch(47),
    path: [computeStartSlotAtEpoch(45), computeStartSlotAtEpoch(46), computeStartSlotAtEpoch(47)],
  },
];

export const overlappingLayers = "1,3,5,7";
export const overlappingLayersData: LayersTest[] = [
  {title: "genesis slot", slot: 0, path: [0]},
  {title: "slot after genesis slot", slot: 5, path: [0], blockReplay: {fromSlot: 1, tillSlot: 5}},
  {
    title: "slot before the epoch 1",
    slot: computeStartSlotAtEpoch(1) - 1,
    path: [0],
    blockReplay: {
      fromSlot: 1,
      tillSlot: computeStartSlotAtEpoch(1) - 1,
    },
  },
  {
    title: "slot at epoch 1",
    slot: computeStartSlotAtEpoch(1),
    path: [0, computeStartSlotAtEpoch(1)],
  },
  {
    title: "slot after epoch 1",
    slot: computeStartSlotAtEpoch(1) + 1,
    path: [0, computeStartSlotAtEpoch(1)],
    blockReplay: {
      fromSlot: computeStartSlotAtEpoch(1) + 1,
      tillSlot: computeStartSlotAtEpoch(1) + 1,
    },
  },
  {
    title: "slot before epoch 2",
    slot: computeStartSlotAtEpoch(2) - 1,
    path: [0, computeStartSlotAtEpoch(1)],
    blockReplay: {
      fromSlot: computeStartSlotAtEpoch(1) + 1,
      tillSlot: computeStartSlotAtEpoch(2) - 1,
    },
  },
  {
    title: "slot at epoch 2",
    slot: computeStartSlotAtEpoch(2),
    path: [0, computeStartSlotAtEpoch(2)],
  },
  {
    title: "slot after epoch 2",
    slot: computeStartSlotAtEpoch(2) + 1,
    path: [0, computeStartSlotAtEpoch(2)],
    blockReplay: {
      fromSlot: computeStartSlotAtEpoch(2) + 1,
      tillSlot: computeStartSlotAtEpoch(2) + 1,
    },
  },
  {
    title: "slot before epoch 3",
    slot: computeStartSlotAtEpoch(3) - 1,
    path: [0, computeStartSlotAtEpoch(2)],
    blockReplay: {
      fromSlot: computeStartSlotAtEpoch(2) + 1,
      tillSlot: computeStartSlotAtEpoch(3) - 1,
    },
  },
  {
    title: "slot at epoch 3",
    slot: computeStartSlotAtEpoch(3),
    path: [0, computeStartSlotAtEpoch(3)],
  },
  {
    title: "slot after epoch 3",
    slot: computeStartSlotAtEpoch(3) + 1,
    path: [0, computeStartSlotAtEpoch(3)],
    blockReplay: {
      fromSlot: computeStartSlotAtEpoch(3) + 1,
      tillSlot: computeStartSlotAtEpoch(3) + 1,
    },
  },
  // Snapshot epoch
  {
    title: "slot before epoch 7",
    slot: computeStartSlotAtEpoch(7) - 1,
    path: [0, computeStartSlotAtEpoch(5), computeStartSlotAtEpoch(6)],
    blockReplay: {
      fromSlot: computeStartSlotAtEpoch(6) + 1,
      tillSlot: computeStartSlotAtEpoch(7) - 1,
    },
  },
  {
    title: "slot at epoch 7",
    slot: computeStartSlotAtEpoch(7),
    path: [computeStartSlotAtEpoch(7)],
  },
  {
    title: "slot after epoch 7",
    slot: computeStartSlotAtEpoch(7) + 1,
    path: [computeStartSlotAtEpoch(7)],
    blockReplay: {
      fromSlot: computeStartSlotAtEpoch(7) + 1,
      tillSlot: computeStartSlotAtEpoch(7) + 1,
    },
  },
  // An epoch after first snapshot
  {
    title: "slot before epoch 8",
    slot: computeStartSlotAtEpoch(8) - 1,
    path: [computeStartSlotAtEpoch(7)],
    blockReplay: {
      fromSlot: computeStartSlotAtEpoch(7) + 1,
      tillSlot: computeStartSlotAtEpoch(8) - 1,
    },
  },
  {
    title: "slot at epoch 8",
    slot: computeStartSlotAtEpoch(8),
    path: [computeStartSlotAtEpoch(7), computeStartSlotAtEpoch(8)],
  },
  {
    title: "slot after epoch 8",
    slot: computeStartSlotAtEpoch(8) + 1,
    path: [computeStartSlotAtEpoch(7), computeStartSlotAtEpoch(8)],
    blockReplay: {
      fromSlot: computeStartSlotAtEpoch(8) + 1,
      tillSlot: computeStartSlotAtEpoch(8) + 1,
    },
  },
];

export const nonOverlappingLayers = "3,5,7";
export const nonOverlappingLayersData: LayersTest[] = [
  {title: "genesis slot", slot: 0, path: [0]},
  {title: "slot after genesis slot", slot: 5, path: [0], blockReplay: {fromSlot: 1, tillSlot: 5}},
  {
    title: "one slot before first diff layer",
    slot: computeStartSlotAtEpoch(3) - 1,
    path: [0],
    blockReplay: {
      fromSlot: 1,
      tillSlot: computeStartSlotAtEpoch(3) - 1,
    },
  },
  {
    title: "at slot of first diff layer",
    slot: computeStartSlotAtEpoch(3),
    path: [0, computeStartSlotAtEpoch(3)],
  },
  {
    title: "after slot of first diff layer",
    slot: computeStartSlotAtEpoch(3) + 1,
    path: [0, computeStartSlotAtEpoch(3)],
    blockReplay: {
      fromSlot: computeStartSlotAtEpoch(3) + 1,
      tillSlot: computeStartSlotAtEpoch(3) + 1,
    },
  },
  {
    title: "one slot before second diff layer",
    slot: computeStartSlotAtEpoch(5) - 1,
    path: [0, computeStartSlotAtEpoch(3)],
    blockReplay: {
      fromSlot: computeStartSlotAtEpoch(3) + 1,
      tillSlot: computeStartSlotAtEpoch(5) - 1,
    },
  },
  {
    title: "at slot of second diff layer",
    slot: computeStartSlotAtEpoch(5),
    path: [0, computeStartSlotAtEpoch(5)],
  },
  {
    title: "after slot of second diff layer",
    slot: computeStartSlotAtEpoch(5) + 1,
    path: [0, computeStartSlotAtEpoch(5)],
    blockReplay: {
      fromSlot: computeStartSlotAtEpoch(5) + 1,
      tillSlot: computeStartSlotAtEpoch(5) + 1,
    },
  },
  {
    title: "one slot before first snapshot",
    slot: computeStartSlotAtEpoch(7) - 1,
    path: [0, computeStartSlotAtEpoch(5), computeStartSlotAtEpoch(6)],
    blockReplay: {
      fromSlot: computeStartSlotAtEpoch(6) + 1,
      tillSlot: computeStartSlotAtEpoch(7) - 1,
    },
  },
  {
    title: "at slot of second diff layer",
    slot: computeStartSlotAtEpoch(7),
    path: [computeStartSlotAtEpoch(7)],
  },
  {
    title: "after slot of second diff layer",
    slot: computeStartSlotAtEpoch(7) + 1,
    path: [computeStartSlotAtEpoch(7)],
    blockReplay: {
      fromSlot: computeStartSlotAtEpoch(7) + 1,
      tillSlot: computeStartSlotAtEpoch(7) + 1,
    },
  },
  {
    title: "at start of the 12 epoch",
    slot: computeStartSlotAtEpoch(12),
    path: [
      // Snapshots will be at start of epoch 0, 7, 14, so for epoch 12 nearest snapshot will be at start of epoch 7
      computeStartSlotAtEpoch(7),
      // Diff for layer 1, will be at 0, 5, 10, 16 epoch
      // Diff for layer 2, will be at 0, 3, 6, 9, 12, 15 epoch
      // So we will pick nearest diff from each layer
      computeStartSlotAtEpoch(10),
      computeStartSlotAtEpoch(12),
    ],
  },
];

export const allLayerTests: (LayersTest & {layers: string})[] = [
  ...mixEpochLayersData.map((data) => ({...data, title: `${mixEpochLayers} - ${data.title}`, layers: mixEpochLayers})),
  ...overlappingLayersData.map((data) => ({
    ...data,
    title: `${overlappingLayers} - ${data.title}`,
    layers: overlappingLayers,
  })),
  ...nonOverlappingLayersData.map((data) => ({
    ...data,
    title: `${nonOverlappingLayers} - ${data.title}`,
    layers: nonOverlappingLayers,
  })),
];
