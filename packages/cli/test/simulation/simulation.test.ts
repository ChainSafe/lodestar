import {join} from "node:path";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  attestationParticipationAssertions,
  // attestationPerSlotAssertions,
  finalityAssertions,
  headsAssertions,
  inclusionDelayAssertions,
  missedBlocksAssertions,
  nodeAssertions,
  nodeSyncedAssertions,
  syncCommitteeAssertions,
} from "../utils/simulation/assertions.js";
import {CLClient, NodePairResult, ELClient} from "../utils/simulation/interfaces.js";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {getEstimatedTimeInSecForRun, logFilesDir, SIM_TESTS_SECONDS_PER_SLOT} from "../utils/simulation/utils.js";

const genesisSlotsDelay = SLOTS_PER_EPOCH * 2;
const runTillEpoch = 6;
const syncWaitEpoch = 2;

describe("simulation test - multi-fork", function () {
  this.timeout(
    `${getEstimatedTimeInSecForRun({
      genesisSlotDelay: genesisSlotsDelay,
      secondsPerSlot: SIM_TESTS_SECONDS_PER_SLOT,
      runTill: runTillEpoch + syncWaitEpoch,
      grace: 0.1, // 10% extra time
    })}s`
  );

  const env = SimulationEnvironment.initWithDefaults(
    {
      id: "multi-fork",
      logsDir: join(logFilesDir, "multi-fork"),
      chainConfig: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        ALTAIR_FORK_EPOCH: 2,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        BELLATRIX_FORK_EPOCH: 4,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        GENESIS_DELAY: genesisSlotsDelay,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        TERMINAL_TOTAL_DIFFICULTY: BigInt(10),
      },
    },
    [
      {id: "node-1", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32},
      {id: "node-2", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32},
      {id: "node-3", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32},
      {id: "node-4", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32},
    ]
  );

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

  for (let epoch = 0; epoch <= runTillEpoch; epoch += 1) {
    describe(`epoch - ${epoch}`, () => {
      before("wait for epoch", async () => {
        // Wait for one extra slot to make sure epoch transition is complete on the state
        await env.waitForSlot(env.clock.getLastSlotOfEpoch(epoch) + 1);

        env.tracker.printNodesInfo(epoch);
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

  describe("sync from genesis", () => {
    let rangeSync: NodePairResult;
    let checkpointSync: NodePairResult;

    before(async () => {
      const {
        data: {finalized},
      } = await env.nodes[0].cl.api.beacon.getStateFinalityCheckpoints("head");

      rangeSync = env.createNodePair({
        id: "range-sync-node",
        cl: CLClient.Lodestar,
        el: ELClient.Geth,
        keysCount: 0,
      });

      checkpointSync = env.createNodePair({
        id: "checkpoint-sync-node",
        cl: CLClient.Lodestar,
        el: ELClient.Geth,
        keysCount: 0,
        wssCheckpoint: `${finalized.root}:${finalized.epoch}`,
      });

      await rangeSync.jobs.el.start();
      await rangeSync.jobs.cl.start();
      await env.network.connectNewNode(rangeSync.nodePair);

      await checkpointSync.jobs.el.start();
      await checkpointSync.jobs.cl.start();
      await env.network.connectNewNode(checkpointSync.nodePair);
    });

    after(async () => {
      await rangeSync.jobs.el.stop();
      await rangeSync.jobs.cl.stop();
      await checkpointSync.jobs.cl.stop();
      await checkpointSync.jobs.cl.stop();
    });

    it("should sync the nodes", async () => {
      await Promise.all([
        nodeSyncedAssertions(env, rangeSync.nodePair, env.clock.getLastSlotOfEpoch(runTillEpoch + 1)),
        nodeSyncedAssertions(env, checkpointSync.nodePair, env.clock.getLastSlotOfEpoch(runTillEpoch + 1)),
      ]);
    });
  });
});
