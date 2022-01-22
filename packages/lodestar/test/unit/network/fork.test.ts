import {expect} from "chai";
import {ForkName} from "@chainsafe/lodestar-params";
import {IBeaconConfig, IForkInfo} from "@chainsafe/lodestar-config";
import {getCurrentAndNextFork, getActiveForks} from "../../../src/network/forks";

function getForkConfig({
  phase0,
  altair,
  bellatrix,
}: {
  phase0: number;
  altair: number;
  bellatrix: number;
}): IBeaconConfig {
  const forks: Record<ForkName, IForkInfo> = {
    phase0: {
      name: ForkName.phase0,
      epoch: phase0,
      version: Buffer.from([0, 0, 0, 0]),
    },
    altair: {
      name: ForkName.altair,
      epoch: altair,
      version: Buffer.from([0, 0, 0, 1]),
    },
    bellatrix: {
      name: ForkName.bellatrix,
      epoch: bellatrix,
      version: Buffer.from([0, 0, 0, 2]),
    },
  };
  const forksAscendingEpochOrder = Object.values(forks);
  const forksDescendingEpochOrder = Object.values(forks).reverse();
  return {forks, forksAscendingEpochOrder, forksDescendingEpochOrder} as IBeaconConfig;
}

const testScenarios = [
  {
    phase0: 0,
    altair: 0,
    bellatrix: Infinity,
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
  const {phase0, altair, bellatrix, testCases} = testScenario;

  describe(`network / fork: phase0: ${phase0}, altair: ${altair}, bellatrix: ${bellatrix}`, () => {
    const forkConfig = getForkConfig({phase0, altair, bellatrix});
    const forks = forkConfig.forks;
    for (const testCase of testCases) {
      const {epoch, currentFork, nextFork, activeForks} = testCase;
      it(` on epoch ${epoch} should return ${JSON.stringify({
        currentFork,
        nextFork,
      })}, getActiveForks: ${activeForks}`, () => {
        expect(getCurrentAndNextFork(forkConfig, epoch)).to.deep.equal({
          currentFork: forks[currentFork as ForkName],
          nextFork: (nextFork && forks[nextFork as ForkName]) ?? undefined,
        });
        expect(getActiveForks(forkConfig, epoch)).to.deep.equal(activeForks);
      });
    }
  });
}
