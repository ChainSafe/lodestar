import {join} from "node:path";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {Epoch} from "@lodestar/types";
import {logFilesDir, SimulationEnvironment} from "../utils/simulation/index.js";
import {
  missedBlocksAssertions,
  attestationParticipationAssertions,
  nodeAssertions,
  inclusionDelayAssertions,
  attestationPerSlotAssertions,
  finalityAssertions,
  headsAssertions,
} from "../utils/simulation/assertions.js";

chai.use(chaiAsPromised);

const nodeCases: {beaconNodes: number; validatorClients: number; validatorsPerClient: number}[] = [
  {beaconNodes: 4, validatorClients: 1, validatorsPerClient: 32},
];

const forksCases: {
  title: string;
  params: {
    altairEpoch: number;
    bellatrixEpoch: number;
    withExternalSigner?: boolean;
    runTill: Epoch;
  };
}[] = [
  {
    title: "mixed forks",
    params: {altairEpoch: 1, bellatrixEpoch: 2, runTill: 6},
  },
  {
    title: "mixed forks with remote signer",
    params: {altairEpoch: 2, bellatrixEpoch: 4, withExternalSigner: true, runTill: 6},
  },
];
for (const {beaconNodes, validatorClients, validatorsPerClient} of nodeCases) {
  for (const {
    title,
    params: {altairEpoch, bellatrixEpoch, withExternalSigner, runTill},
  } of forksCases) {
    const testIdStr = [
      `beaconNodes-${beaconNodes}`,
      `validatorClients-${validatorClients}`,
      `validatorsPerClient-${validatorsPerClient}`,
      `altair-${altairEpoch}`,
      `bellatrix-${bellatrixEpoch}`,
      `externalSigner-${withExternalSigner ? "yes" : "no"}`,
    ].join("_");

    console.log(
      JSON.stringify({
        beaconNodes,
        validatorClients,
        validatorsPerClient,
        altairEpoch,
        bellatrixEpoch,
        withExternalSigner,
      })
    );
    const env = new SimulationEnvironment({
      beaconNodes,
      validatorClients,
      validatorsPerClient,
      altairEpoch,
      bellatrixEpoch,
      logFilesDir: join(logFilesDir, testIdStr),
      externalSigner: withExternalSigner,
    });

    describe(`simulation test - ${testIdStr}`, function () {
      this.timeout("5m");

      describe(title, async () => {
        before("start env", async () => {
          await env.start();
          await env.network.connectAllNodes();
        });

        after("stop env", async () => {
          env.tracker.printNoesInfo();
          env.resetCounter();
          await env.stop();
        });

        describe("nodes env", () => {
          nodeAssertions(env);
        });

        for (let epoch = 0; epoch <= runTill; epoch += 1) {
          describe(`epoch - ${epoch}`, () => {
            before("wait for epoch", async () => {
              // Wait for one extra slot to make sure epoch transition is complete on the state
              await env.waitForEndOfSlot(env.clock.getLastSlotOfEpoch(epoch) + 1);

              env.tracker.printNoesInfo();
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

            describe("attestation count per slot", () => {
              attestationPerSlotAssertions(env, epoch);
            });

            describe("attestation participation", () => {
              attestationParticipationAssertions(env, epoch);
            });
          });
        }
      });
    });
  }
}
