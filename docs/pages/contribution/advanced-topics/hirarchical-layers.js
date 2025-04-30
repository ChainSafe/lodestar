// mainnet parameters
const SLOTS_PER_EPOCH = 32;
const SECONDS_PER_SLOT = 12;

// Simulation parameters
const simPeriod = 60 * 60 * 24 * 30; // 30 days
const S_full = 1024 * 1024 * 1.8;
const S_diff = 1024 * 48;
const T_full = 100;
const T_diff = 150;
const T_replay = 100;
const R_full = 10;
const R_diff = 50;
const W_s = 1;
const W_b = 1;
const W_r = 1;

const totalEpochs = Math.floor(simPeriod / SECONDS_PER_SLOT / SLOTS_PER_EPOCH);
const totalSlots = totalEpochs * SLOTS_PER_EPOCH;
const isStartOfEpoch = (slot) => slot % SLOTS_PER_EPOCH === 0;
const getlayerEpochs = (layers) => [
  ...new Set(
    layers
      .split(",")
      .map((s) => s.trim())
      .map((n) => parseInt(n))
  ),
];

function cost(layerConfig) {
  const layerEpochs = getlayerEpochs(layerConfig);
  const layers = {};
  const slotLayerMap = {};
  for (const [v] of layerEpochs.entries()) {
    layers[v] = [];
  }

  for (const [i, v] of layerEpochs.reverse().entries()) {
    for (let slot = 0; slot <= totalSlots; slot++) {
      if (isStartOfEpoch(slot) && slot % v === 0 && slotLayerMap[slot] === undefined) {
        layers[i].push(slot);
        slotLayerMap[slot] = i;
      }
    }
  }

  const totalLayers = Object.keys(layers).length;
  const F = layers[0].length;
  // const D = layers;
  // We assume that operation for every diff cost same on each layer so we use total value instead.
  const totalDiffs = Object.keys(layers)
    .filter((l) => l !== "0")
    .map((l) => layers[l].length)
    .reduce((a, b) => a + b, 0);

  const storageCost = F * S_full + totalDiffs * S_diff;
  const backupTime = F * T_full + totalDiffs * T_diff;
  const restoreTime = F * R_full + totalDiffs * R_diff;

  const singleRestoreTime = (R_diff * (totalLayers - 1) + R_full) * layerEpochs[layerEpochs.length - 1];
  return Math.ceil(
    (W_s * storageCost + W_b * backupTime + W_r * restoreTime) / singleRestoreTime +
      layerEpochs[0] * SLOTS_PER_EPOCH * T_replay
  );
}

for (let n = 1; n <= 4; n++) {
  const layersConfig = `${2 ** n}, ${2 ** (n + 1)}, ${2 ** (n + 2)}, ${2 ** (n + 3)}`;
  console.log(layersConfig, cost(layersConfig));
}

for (let n = 1; n <= 4; n++) {
  const layersConfig = `${2 ** n}, ${2 ** (n + 2)}, ${2 ** (n + 4)}, ${2 ** (n + 6)}`;
  console.log(layersConfig, cost(layersConfig));
}

for (let n = 1; n <= 4; n++) {
  const layersConfig = `${2 ** n}, ${2 ** (n + 3)}, ${2 ** (n + 6)}, ${2 ** (n + 9)}`;
  console.log(layersConfig, cost(layersConfig));
}

for (let n = 1; n <= 4; n++) {
  const layersConfig = `${2 ** n}, ${2 ** (n + 2)}, ${2 ** (n + 4)}, ${2 ** (n + 6)}, ${2 ** (n + 8)}`;
  console.log(layersConfig, cost(layersConfig));
}
