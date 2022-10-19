import {join} from "node:path";
import {Epoch} from "@lodestar/types";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {logFilesDir} from "../utils/simulation/utils.js";
import {
  missedBlocksAssertions,
  attestationParticipationAssertions,
  nodeAssertions,
  inclusionDelayAssertions,
  // attestationPerSlotAssertions,
  finalityAssertions,
  headsAssertions,
  syncCommitteeAssertions,
} from "../utils/simulation/assertions.js";

const nodeCases: {beaconNodes: number; validatorClients: number; validatorsPerClient: number}[] = [
  {beaconNodes: 4, validatorClients: 1, validatorsPerClient: 32},
];

const forksCases: {
  title: string;
  params: {
    altairEpoch: number;
    bellatrixEpoch: number;
    runTill: Epoch;
  };
}[] = [
  {
    title: "mixed forks",
    params: {altairEpoch: 2, bellatrixEpoch: 4, runTill: 6},
  },
];

let testCases = 0;

for (const {beaconNodes, validatorClients, validatorsPerClient} of nodeCases) {
  for (const {
    title,
    params: {altairEpoch, bellatrixEpoch, runTill},
  } of forksCases) {
    const testIdStr = [
      `beaconNodes-${beaconNodes}`,
      `validatorClients-${validatorClients}`,
      `validatorsPerClient-${validatorsPerClient}`,
      `altair-${altairEpoch}`,
      `bellatrix-${bellatrixEpoch}`,
    ].join("_");

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        beaconNodes,
        validatorClients,
        validatorsPerClient,
        altairEpoch,
        bellatrixEpoch,
      })
    );
    const env = new SimulationEnvironment({
      beaconNodes,
      validatorClients,
      validatorsPerClient,
      altairEpoch,
      // TODO: Use extra delay until env.clock is based on absolute time
      genesisSlotsDelay: (SLOTS_PER_EPOCH * runTill + 50) * testCases + 30,
      bellatrixEpoch,
      logFilesDir: join(logFilesDir, testIdStr),
    });
    testCases += 1;

    describe(`simulation test - ${testIdStr}`, function () {
      this.timeout("5m");

      describe(title, () => {
        before("start env", async () => {
          await env.start();
          await env.network.connectAllNodes();
        });

        after("stop env", async () => {
          await env.stop();
        });

        describe("nodes env", () => {
          nodeAssertions(env);
        });

        for (let epoch = 0; epoch <= runTill; epoch += 1) {
          describe(`epoch - ${epoch}`, () => {
            before("wait for epoch", async () => {
              // Wait for one extra slot to make sure epoch transition is complete on the state
              await env.waitForSlot(env.clock.getLastSlotOfEpoch(epoch) + 1);

              env.tracker.printNoesInfo(epoch);
            });

            describe("missed blocks", () => {
              missedBlocksAssertions(env, epoch);
            });

            describe("finality", () => {
              finalityAssertions(env, epoch);
            });

            describe("heads", () => {
              headsAssertions(env, epoch);
            });

            describe("inclusion delay", () => {
              inclusionDelayAssertions(env, epoch);
            });

            // describe("attestation count per slot", () => {
            //   attestationPerSlotAssertions(env, epoch);
            // });

            describe("attestation participation", () => {
              attestationParticipationAssertions(env, epoch);
            });

            describe("sync committee participation", () => {
              syncCommitteeAssertions(env, epoch);
            });
          });
        }
      });
    });
  }
}
