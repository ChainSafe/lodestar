// DON'T MODIFY OR FORMAT THIS FILE
// USE FOR GA CACHE

export const phase0State = {
  network: "mainnet" as const,
  epoch: 58758, // Pre-altair fork
};

export const altairState = {
  network: "mainnet" as const,
  epoch: 81889, // Post altair fork
};

export const rangeSyncTest = {
  network: "mainnet" as const,
  startSlot: 3766816, // Post altair, first slot in epoch 117713
  endSlot: 3766847, // 3766816 + 31, all blocks in same epoch
};
