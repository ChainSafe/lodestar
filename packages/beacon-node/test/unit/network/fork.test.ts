import {describe, it, expect} from "vitest";
import {ForkName, ForkSeq} from "@lodestar/params";
import {BeaconConfig, ForkInfo} from "@lodestar/config";
import {getCurrentAndNextFork, getActiveForks} from "../../../src/network/forks.js";

function getForkConfig({
  phase0,
  altair,
  bellatrix,
  capella,
  deneb,
  electra,
}: {
  phase0: number;
  altair: number;
  bellatrix: number;
  capella: number;
  deneb: number;
  electra: number;
}): BeaconConfig {
  const forks: Record<ForkName, ForkInfo> = {
    phase0: {
      name: ForkName.phase0,
      seq: ForkSeq.phase0,
      epoch: phase0,
      version: Buffer.from([0, 0, 0, 0]),
      prevVersion: Buffer.from([0, 0, 0, 0]),
      prevForkName: ForkName.phase0,
    },
    altair: {
      name: ForkName.altair,
      seq: ForkSeq.altair,
      epoch: altair,
      version: Buffer.from([0, 0, 0, 1]),
      prevVersion: Buffer.from([0, 0, 0, 0]),
      prevForkName: ForkName.phase0,
    },
    bellatrix: {
      name: ForkName.bellatrix,
      seq: ForkSeq.bellatrix,
      epoch: bellatrix,
      version: Buffer.from([0, 0, 0, 2]),
      prevVersion: Buffer.from([0, 0, 0, 1]),
      prevForkName: ForkName.altair,
    },
    capella: {
      name: ForkName.capella,
      seq: ForkSeq.capella,
      epoch: capella,
      version: Buffer.from([0, 0, 0, 3]),
      prevVersion: Buffer.from([0, 0, 0, 2]),
      prevForkName: ForkName.bellatrix,
    },
    deneb: {
      name: ForkName.deneb,
      seq: ForkSeq.deneb,
      epoch: deneb,
      version: Buffer.from([0, 0, 0, 4]),
      prevVersion: Buffer.from([0, 0, 0, 3]),
      prevForkName: ForkName.capella,
    },
    electra: {
      name: ForkName.electra,
      seq: ForkSeq.electra,
      epoch: electra,
      version: Buffer.from([0, 0, 0, 4]),
      prevVersion: Buffer.from([0, 0, 0, 3]),
      prevForkName: ForkName.capella,
    },
  };
  const forksAscendingEpochOrder = Object.values(forks);
  const forksDescendingEpochOrder = Object.values(forks).reverse();
  return {forks, forksAscendingEpochOrder, forksDescendingEpochOrder} as BeaconConfig;
}

const testScenarios = [
  {
    phase0: 0,
    altair: 0,
    bellatrix: Infinity,
    capella: Infinity,
    testCases: [
      {epoch: -1, currentFork: "altair", nextFork: undefined, activeForks: ["altair"]},
      {epoch: 0, currentFork: "altair", nextFork: undefined, activeForks: ["altair"]},
      {epoch: 1, currentFork: "altair", nextFork: undefined, activeForks: ["altair"]},
    ],
  },
  {
    phase0: 0,
    altair: 0,
    bellatrix: 0,
    capella: Infinity,
    testCases: [
      {epoch: -1, currentFork: "bellatrix", nextFork: undefined, activeForks: ["bellatrix"]},
      {epoch: 0, currentFork: "bellatrix", nextFork: undefined, activeForks: ["bellatrix"]},
      {epoch: 1, currentFork: "bellatrix", nextFork: undefined, activeForks: ["bellatrix"]},
    ],
  },
  {
    phase0: 0,
    altair: 1,
    bellatrix: 1,
    capella: Infinity,
    testCases: [
      {epoch: -1, currentFork: "phase0", nextFork: "bellatrix", activeForks: ["phase0", "bellatrix"]},
      {epoch: 2, currentFork: "bellatrix", nextFork: undefined, activeForks: ["phase0", "bellatrix"]},
      {epoch: 3, currentFork: "bellatrix", nextFork: undefined, activeForks: ["phase0", "bellatrix"]},
      {epoch: 4, currentFork: "bellatrix", nextFork: undefined, activeForks: ["bellatrix"]},
    ],
  },
  {
    phase0: 0,
    altair: 1,
    bellatrix: 2,
    capella: Infinity,
    testCases: [
      {epoch: -1, currentFork: "phase0", nextFork: "altair", activeForks: ["phase0", "altair"]},
      {epoch: 0, currentFork: "phase0", nextFork: "altair", activeForks: ["phase0", "altair", "bellatrix"]},
      {epoch: 1, currentFork: "altair", nextFork: "bellatrix", activeForks: ["phase0", "altair", "bellatrix"]},
      {epoch: 2, currentFork: "bellatrix", nextFork: undefined, activeForks: ["phase0", "altair", "bellatrix"]},
      {epoch: 3, currentFork: "bellatrix", nextFork: undefined, activeForks: ["phase0", "altair", "bellatrix"]},
      {epoch: 4, currentFork: "bellatrix", nextFork: undefined, activeForks: ["altair", "bellatrix"]},
      {epoch: 5, currentFork: "bellatrix", nextFork: undefined, activeForks: ["bellatrix"]},
    ],
  },
  {
    phase0: 0,
    altair: 5,
    bellatrix: 10,
    capella: Infinity,
    testCases: [
      {epoch: -1, currentFork: "phase0", nextFork: "altair", activeForks: ["phase0"]},
      {epoch: 3, currentFork: "phase0", nextFork: "altair", activeForks: ["phase0", "altair"]},
      {epoch: 7, currentFork: "altair", nextFork: "bellatrix", activeForks: ["phase0", "altair"]},
      {epoch: 8, currentFork: "altair", nextFork: "bellatrix", activeForks: ["altair", "bellatrix"]},
      {epoch: 11, currentFork: "bellatrix", nextFork: undefined, activeForks: ["altair", "bellatrix"]},
      {epoch: 12, currentFork: "bellatrix", nextFork: undefined, activeForks: ["altair", "bellatrix"]},
      {epoch: 13, currentFork: "bellatrix", nextFork: undefined, activeForks: ["bellatrix"]},
    ],
  },
];

for (const testScenario of testScenarios) {
  const {phase0, altair, bellatrix, capella, testCases} = testScenario;
  const deneb = Infinity;
  const electra = Infinity;

  describe(`network / fork: phase0: ${phase0}, altair: ${altair}, bellatrix: ${bellatrix} capella: ${capella}`, () => {
    const forkConfig = getForkConfig({phase0, altair, bellatrix, capella, deneb, electra});
    const forks = forkConfig.forks;
    for (const testCase of testCases) {
      const {epoch, currentFork, nextFork, activeForks} = testCase;
      it(` on epoch ${epoch} should return ${JSON.stringify({
        currentFork,
        nextFork,
      })}, getActiveForks: ${activeForks.join(",")}`, () => {
        expect(getCurrentAndNextFork(forkConfig, epoch)).toEqual({
          currentFork: forks[currentFork as ForkName],
          nextFork: (nextFork && forks[nextFork as ForkName]) ?? undefined,
        });
        expect(getActiveForks(forkConfig, epoch)).toEqual(activeForks);
      });
    }
  });
}
