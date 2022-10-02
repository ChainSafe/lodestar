import {join} from "node:path";
import {Epoch} from "@lodestar/types";
import {ACTIVE_PRESET, PresetName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {getAfterEachCallbacks, itDone} from "../utils/runUtils.js";
import {testLogsDirPath} from "../specs.js";
import {Eth2Client} from "./eth2clients/interface.js";
import {SimulationEnvironment} from "./SimulationEnvironment.js";
import {SimulationTracker} from "./SimulationTracker.js";

/* eslint-disable @typescript-eslint/naming-convention */

interface Participant {
  client: Eth2Client;
  keys: number;
  externalSigner?: boolean;
}

const nodeCases: {nodeCaseId: string; preset: PresetName; participants: Participant[]}[] = [
  {
    nodeCaseId: "bn-4_ks-128_lighthouse-2",
    preset: PresetName.mainnet,
    participants: [
      {client: Eth2Client.lodestar, keys: 4},
      {client: Eth2Client.lodestar, keys: 4, externalSigner: true},
      {client: Eth2Client.lighthouse, keys: 4},
      {client: Eth2Client.lighthouse, keys: 4},
    ],
  },
];

const SECONDS_PER_SLOT = process.env.DEBUG_FAST_SLOT ? 2 : 6;
const validatorClients = 1;
const minSyncParticipation = 1.0;
const maxBlocksWithLowMinSyncParticipation = 1.0;
const minEpochParticipation = {source: 1.0, target: 1.0, head: 1.0};
const maxAttestationInclusionScore = 0;

const forksCases: {
  ALTAIR_FORK_EPOCH: Epoch;
  BELLATRIX_FORK_EPOCH: Epoch;
  runTillEpoch: Epoch;
}[] = [{ALTAIR_FORK_EPOCH: 3, BELLATRIX_FORK_EPOCH: 6, runTillEpoch: 10}];

for (const {nodeCaseId, preset, participants} of nodeCases) {
  for (const {ALTAIR_FORK_EPOCH, BELLATRIX_FORK_EPOCH, runTillEpoch} of forksCases) {
    const testIdStr = [nodeCaseId, preset, `a-${ALTAIR_FORK_EPOCH}`, `b-${BELLATRIX_FORK_EPOCH}`]
      .filter(Boolean)
      .join("_");

    describe(testIdStr, function () {
      const afterEachCallbacks = getAfterEachCallbacks();

      // Create SimulationEnvironment in before step, since it may error
      let env: SimulationEnvironment;

      before("create SimulationEnvironment", async function () {
        // Allow enough time to pull images and create keystores
        this.timeout(5 * 60 * 1000);

        if (ACTIVE_PRESET !== preset) {
          throw Error(`ACTIVE_PRESET ${ACTIVE_PRESET} !== preset ${preset}`);
        }

        env = await SimulationEnvironment.fromParams({
          runId: testIdStr,
          preset: preset,
          beaconNodes: participants.map((participant) => ({
            client: participant.client,
            validatorClients,
            keysPerValidatorClient: participant.keys,
            useExternalSigner: participant.externalSigner === true,
          })),
          chainConfig: {
            SECONDS_PER_SLOT,
            ALTAIR_FORK_EPOCH,
            BELLATRIX_FORK_EPOCH,
            CONFIG_NAME: testIdStr,
          },
          logFilesDir: join(testLogsDirPath, testIdStr),
        });
      });

      after("kill env", async () => {
        await env?.kill();
      });

      itDone(`Run ${testIdStr}`, async function (onError) {
        const minRunTime = runTillEpoch * SLOTS_PER_EPOCH * SECONDS_PER_SLOT * 1000;
        const marginFactor = 1.25;
        const startUpTime = 90 * 1000;
        this.timeout(minRunTime * marginFactor + startUpTime);

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
