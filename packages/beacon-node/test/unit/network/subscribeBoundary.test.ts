import {
  BlobSchedule,
  ChainConfig,
  ChainForkConfig,
  SubscribeBoundary,
  SubscribeBoundaryType,
  createChainForkConfig,
} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {describe, expect, it} from "vitest";
import {getActiveSubscribeBoundaries} from "../../../src/network/forks.js";

function getForkConfig({
  altair,
  bellatrix,
  capella,
  deneb,
  electra,
  fulu,
  blobSchedule,
}: {
  altair: number;
  bellatrix: number;
  capella: number;
  deneb: number;
  electra: number;
  fulu: number;
  blobSchedule: BlobSchedule;
}): ChainForkConfig {
  const forkEpochs: Partial<ChainConfig> = {
    ALTAIR_FORK_EPOCH: altair,
    BELLATRIX_FORK_EPOCH: bellatrix,
    CAPELLA_FORK_EPOCH: capella,
    DENEB_FORK_EPOCH: deneb,
    ELECTRA_FORK_EPOCH: electra,
    FULU_FORK_EPOCH: fulu,
    BLOB_SCHEDULE: blobSchedule,
  };

  return createChainForkConfig({...defaultConfig, ...forkEpochs});
}

const testScenarios: {
  altair: number;
  bellatrix: number;
  capella: number;
  deneb: number;
  electra: number;
  fulu: number;
  blobSchedule: BlobSchedule;
  testCases: {epoch: number; activeBoundaries: SubscribeBoundary[]}[];
}[] = [
  {
    altair: 0,
    bellatrix: Infinity,
    capella: Infinity,
    deneb: Infinity,
    electra: Infinity,
    fulu: Infinity,
    blobSchedule: [] as BlobSchedule,
    testCases: [
      {epoch: -1, activeBoundaries: [{type: SubscribeBoundaryType.PreFulu, fork: ForkName.altair, epoch: 0}]},
      {epoch: 0, activeBoundaries: [{type: SubscribeBoundaryType.PreFulu, fork: ForkName.altair, epoch: 0}]},
      {epoch: 1, activeBoundaries: [{type: SubscribeBoundaryType.PreFulu, fork: ForkName.altair, epoch: 0}]},
    ],
  },
  {
    altair: 10,
    bellatrix: 20,
    capella: 30,
    deneb: 40,
    electra: 50,
    fulu: Infinity,
    blobSchedule: [] as BlobSchedule,
    testCases: [
      {
        epoch: 50,
        activeBoundaries: [
          {type: SubscribeBoundaryType.PreFulu, fork: ForkName.deneb, epoch: 40},
          {type: SubscribeBoundaryType.PreFulu, fork: ForkName.electra, epoch: 50},
        ],
      },
      {epoch: 55, activeBoundaries: [{type: SubscribeBoundaryType.PreFulu, fork: ForkName.electra, epoch: 50}]},
    ],
  },
  {
    altair: 10,
    bellatrix: 20,
    capella: 30,
    deneb: 40,
    electra: 50,
    fulu: 60,
    blobSchedule: [] as BlobSchedule,
    testCases: [
      {
        epoch: 50,
        activeBoundaries: [
          {type: SubscribeBoundaryType.PreFulu, fork: ForkName.deneb, epoch: 40},
          {type: SubscribeBoundaryType.PreFulu, fork: ForkName.electra, epoch: 50},
        ],
      },
      {epoch: 55, activeBoundaries: [{type: SubscribeBoundaryType.PreFulu, fork: ForkName.electra, epoch: 50}]},
      {
        epoch: 60,
        activeBoundaries: [
          {type: SubscribeBoundaryType.PreFulu, fork: ForkName.electra, epoch: 50},
          {
            type: SubscribeBoundaryType.HardFork,
            fork: ForkName.fulu,
            epoch: 60,
            blobSchedule: {EPOCH: 50, MAX_BLOBS_PER_BLOCK: defaultConfig.MAX_BLOBS_PER_BLOCK_ELECTRA},
          },
        ],
      },
      {
        epoch: 65,
        activeBoundaries: [
          {
            type: SubscribeBoundaryType.HardFork,
            fork: ForkName.fulu,
            epoch: 60,
            blobSchedule: {EPOCH: 50, MAX_BLOBS_PER_BLOCK: defaultConfig.MAX_BLOBS_PER_BLOCK_ELECTRA},
          },
        ],
      },
    ],
  },
  {
    altair: 0,
    bellatrix: 0,
    capella: 0,
    deneb: 0,
    electra: 10,
    fulu: 20,
    blobSchedule: [
      {EPOCH: 20, MAX_BLOBS_PER_BLOCK: 200},
      {EPOCH: 25, MAX_BLOBS_PER_BLOCK: 250},
      {EPOCH: 30, MAX_BLOBS_PER_BLOCK: 300},
    ],
    testCases: [
      {
        epoch: 10,
        activeBoundaries: [
          {type: SubscribeBoundaryType.PreFulu, fork: ForkName.deneb, epoch: 0},
          {type: SubscribeBoundaryType.PreFulu, fork: ForkName.electra, epoch: 10},
        ],
      },
      {epoch: 15, activeBoundaries: [{type: SubscribeBoundaryType.PreFulu, fork: ForkName.electra, epoch: 10}]},
      {
        epoch: 20,
        activeBoundaries: [
          {type: SubscribeBoundaryType.PreFulu, fork: ForkName.electra, epoch: 10},
          {
            type: SubscribeBoundaryType.BpoFork,
            fork: ForkName.fulu,
            epoch: 20,
            blobSchedule: {EPOCH: 20, MAX_BLOBS_PER_BLOCK: 200},
          },
        ],
      },
      {
        epoch: 25,
        activeBoundaries: [
          {
            type: SubscribeBoundaryType.BpoFork,
            fork: ForkName.fulu,
            epoch: 20,
            blobSchedule: {EPOCH: 20, MAX_BLOBS_PER_BLOCK: 200},
          },
          {
            type: SubscribeBoundaryType.BpoFork,
            fork: ForkName.fulu,
            epoch: 25,
            blobSchedule: {EPOCH: 25, MAX_BLOBS_PER_BLOCK: 250},
          },
        ],
      },
      {
        epoch: 30,
        activeBoundaries: [
          {
            type: SubscribeBoundaryType.BpoFork,
            fork: ForkName.fulu,
            epoch: 25,
            blobSchedule: {EPOCH: 25, MAX_BLOBS_PER_BLOCK: 250},
          },
          {
            type: SubscribeBoundaryType.BpoFork,
            fork: ForkName.fulu,
            epoch: 30,
            blobSchedule: {EPOCH: 30, MAX_BLOBS_PER_BLOCK: 300},
          },
        ],
      },
      {
        epoch: 33,
        activeBoundaries: [
          {
            type: SubscribeBoundaryType.BpoFork,
            fork: ForkName.fulu,
            epoch: 30,
            blobSchedule: {EPOCH: 30, MAX_BLOBS_PER_BLOCK: 300},
          },
        ],
      },
    ],
  },
  {
    altair: 0,
    bellatrix: 0,
    capella: 0,
    deneb: 0,
    electra: 10,
    fulu: 20,
    blobSchedule: [
      {EPOCH: 30, MAX_BLOBS_PER_BLOCK: 300},
      {EPOCH: 40, MAX_BLOBS_PER_BLOCK: 400},
    ],
    testCases: [
      {
        epoch: 20,
        activeBoundaries: [
          {type: SubscribeBoundaryType.PreFulu, fork: ForkName.electra, epoch: 10},
          {
            type: SubscribeBoundaryType.HardFork,
            fork: ForkName.fulu,
            epoch: 20,
            blobSchedule: {EPOCH: 10, MAX_BLOBS_PER_BLOCK: defaultConfig.MAX_BLOBS_PER_BLOCK_ELECTRA},
          },
        ],
      },
      {
        epoch: 25,
        activeBoundaries: [
          {
            type: SubscribeBoundaryType.HardFork,
            fork: ForkName.fulu,
            epoch: 20,
            blobSchedule: {EPOCH: 10, MAX_BLOBS_PER_BLOCK: defaultConfig.MAX_BLOBS_PER_BLOCK_ELECTRA},
          },
        ],
      },
      {
        epoch: 30,
        activeBoundaries: [
          {
            type: SubscribeBoundaryType.HardFork,
            fork: ForkName.fulu,
            epoch: 20,
            blobSchedule: {EPOCH: 10, MAX_BLOBS_PER_BLOCK: defaultConfig.MAX_BLOBS_PER_BLOCK_ELECTRA},
          },
          {
            type: SubscribeBoundaryType.BpoFork,
            fork: ForkName.fulu,
            epoch: 30,
            blobSchedule: {EPOCH: 30, MAX_BLOBS_PER_BLOCK: 300},
          },
        ],
      },
      {
        epoch: 35,
        activeBoundaries: [
          {
            type: SubscribeBoundaryType.BpoFork,
            fork: ForkName.fulu,
            epoch: 30,
            blobSchedule: {EPOCH: 30, MAX_BLOBS_PER_BLOCK: 300},
          },
        ],
      },
      {
        epoch: 40,
        activeBoundaries: [
          {
            type: SubscribeBoundaryType.BpoFork,
            fork: ForkName.fulu,
            epoch: 30,
            blobSchedule: {EPOCH: 30, MAX_BLOBS_PER_BLOCK: 300},
          },
          {
            type: SubscribeBoundaryType.BpoFork,
            fork: ForkName.fulu,
            epoch: 40,
            blobSchedule: {EPOCH: 40, MAX_BLOBS_PER_BLOCK: 400},
          },
        ],
      },
      {
        epoch: 45,
        activeBoundaries: [
          {
            type: SubscribeBoundaryType.BpoFork,
            fork: ForkName.fulu,
            epoch: 40,
            blobSchedule: {EPOCH: 40, MAX_BLOBS_PER_BLOCK: 400},
          },
        ],
      },
    ],
  },
  {
    altair: 0,
    bellatrix: 0,
    capella: 0,
    deneb: 0,
    electra: 10,
    fulu: 20,
    blobSchedule: [
      {EPOCH: 22, MAX_BLOBS_PER_BLOCK: 220},
      {EPOCH: 24, MAX_BLOBS_PER_BLOCK: 240},
    ],
    testCases: [
      {
        epoch: 20,
        activeBoundaries: [
          {type: SubscribeBoundaryType.PreFulu, fork: ForkName.electra, epoch: 10},
          {
            type: SubscribeBoundaryType.HardFork,
            fork: ForkName.fulu,
            epoch: 20,
            blobSchedule: {EPOCH: 10, MAX_BLOBS_PER_BLOCK: defaultConfig.MAX_BLOBS_PER_BLOCK_ELECTRA},
          },
          {
            type: SubscribeBoundaryType.BpoFork,
            fork: ForkName.fulu,
            epoch: 22,
            blobSchedule: {EPOCH: 22, MAX_BLOBS_PER_BLOCK: 220},
          },
        ],
      },
      {
        epoch: 23,
        activeBoundaries: [
          {
            type: SubscribeBoundaryType.HardFork,
            fork: ForkName.fulu,
            epoch: 20,
            blobSchedule: {EPOCH: 10, MAX_BLOBS_PER_BLOCK: defaultConfig.MAX_BLOBS_PER_BLOCK_ELECTRA},
          },
          {
            type: SubscribeBoundaryType.BpoFork,
            fork: ForkName.fulu,
            epoch: 22,
            blobSchedule: {EPOCH: 22, MAX_BLOBS_PER_BLOCK: 220},
          },
          {
            type: SubscribeBoundaryType.BpoFork,
            fork: ForkName.fulu,
            epoch: 24,
            blobSchedule: {EPOCH: 24, MAX_BLOBS_PER_BLOCK: 240},
          },
        ],
      },
      {
        epoch: 25,
        activeBoundaries: [
          {
            type: SubscribeBoundaryType.BpoFork,
            fork: ForkName.fulu,
            epoch: 22,
            blobSchedule: {EPOCH: 22, MAX_BLOBS_PER_BLOCK: 220},
          },
          {
            type: SubscribeBoundaryType.BpoFork,
            fork: ForkName.fulu,
            epoch: 24,
            blobSchedule: {EPOCH: 24, MAX_BLOBS_PER_BLOCK: 240},
          },
        ],
      },
      {
        epoch: 27,
        activeBoundaries: [
          {
            type: SubscribeBoundaryType.BpoFork,
            fork: ForkName.fulu,
            epoch: 24,
            blobSchedule: {EPOCH: 24, MAX_BLOBS_PER_BLOCK: 240},
          },
        ],
      },
    ],
  },
];

for (const testScenario of testScenarios) {
  const {altair, bellatrix, capella, deneb, electra, fulu, blobSchedule, testCases} = testScenario;

  describe("network / forks / getActiveSubscribeBoundaries", () => {
    const forkConfig = getForkConfig({altair, bellatrix, capella, deneb, electra, fulu, blobSchedule});
    for (const testCase of testCases) {
      const {epoch, activeBoundaries} = testCase;
      it(` on epoch ${epoch} should return ${JSON.stringify(activeBoundaries)}`, () => {
        expect(getActiveSubscribeBoundaries(forkConfig, epoch)).toEqual(activeBoundaries);
      });
    }
  });
}
