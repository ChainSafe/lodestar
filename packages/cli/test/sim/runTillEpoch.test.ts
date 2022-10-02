import {join} from "node:path";
import {Epoch} from "@lodestar/types";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {getAfterEachCallbacks, itDone} from "../utils/runUtils.js";
import {Eth2Client} from "../utils/simulation/eth2clients/interface.js";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {SimulationTracker} from "../utils/simulation/SimulationTracker.js";
import {testLogsDirPath} from "../specs.js";

/* eslint-disable @typescript-eslint/naming-convention */

const nodeCases: {beaconNodes: number; validatorClients: number; keysPerValidatorClient: number}[] = [
  {beaconNodes: 4, validatorClients: 1, keysPerValidatorClient: 32},
];

const SECONDS_PER_SLOT = process.env.DEBUG_FAST_SLOT ? 2 : 6;
const minSyncParticipation = 1;
const maxBlocksWithLowMinSyncParticipation = 1;
const minEpochParticipation = {source: 1, target: 1, head: 1};
const maxAttestationInclusionScore = 0;

const forksCases: {
  ALTAIR_FORK_EPOCH: Epoch;
  BELLATRIX_FORK_EPOCH: Epoch;
  runTillEpoch: Epoch;
}[] = [{ALTAIR_FORK_EPOCH: 3, BELLATRIX_FORK_EPOCH: 6, runTillEpoch: 10}];

for (const {beaconNodes, validatorClients, keysPerValidatorClient} of nodeCases) {
  for (const {ALTAIR_FORK_EPOCH, BELLATRIX_FORK_EPOCH, runTillEpoch} of forksCases) {
    const testIdStr = [
      `bn-${beaconNodes}`,
      `vc-${validatorClients}`,
      `ks-${keysPerValidatorClient}`,
      `altair-${ALTAIR_FORK_EPOCH}`,
      `bellatrix-${BELLATRIX_FORK_EPOCH}`,
    ]
      .filter(Boolean)
      .join("_");

    describe(testIdStr, function () {
      const minRunTime = runTillEpoch * SLOTS_PER_EPOCH * SECONDS_PER_SLOT * 1000;
      const marginFactor = 1.25;
      const startUpTime = 90 * 1000;
      this.timeout(minRunTime * marginFactor + startUpTime);

      const afterEachCallbacks = getAfterEachCallbacks();

      // Create SimulationEnvironment in before step, since it may error
      let env: SimulationEnvironment;

      before("create SimulationEnvironment", async () => {
        env = await SimulationEnvironment.fromParams({
          runId: testIdStr,
          beaconNodes: Array.from({length: beaconNodes}, (_, i) => ({
            client: Eth2Client.lodestar,
            validatorClients,
            keysPerValidatorClient,
            // Half with external signer, odd indexes
            useExternalSigner: i % 2 != 0,
          })),
          chainConfig: {
            SECONDS_PER_SLOT,
            ALTAIR_FORK_EPOCH,
            BELLATRIX_FORK_EPOCH,
          },
          logFilesDir: join(testLogsDirPath, testIdStr),
        });
      });

      after("kill env", async () => {
        await env.kill();
      });

      itDone(`Run ${testIdStr}`, async function (onError) {
        // Ensures that genesis has not happened yet
        await env.start(onError);

        const tracker = new SimulationTracker(env.getNetworkData(), {
          minSyncParticipation,
          maxBlocksWithLowMinSyncParticipation,
          minEpochParticipation,
          maxAttestationInclusionScore,
        });
        afterEachCallbacks.push(() => tracker.stop());

        await env.waitForEpoch(0);
        // TODO: In current runs all nodes disconnect from each other due to an unknown reason
        // CI example https://github.com/ChainSafe/lodestar/actions/runs/3169594171
        await env.reconnectAllBeaconNodes();

        // Ensure nodes are connected before going through the full run
        await tracker.assertHealthyGenesis();

        // Wait for 2 slots into the epoch to count participation of the previous epoch
        await env.waitForEpoch(runTillEpoch + 2 / SLOTS_PER_EPOCH);

        tracker.assertNoErrors();
      });
    });
  }
}
