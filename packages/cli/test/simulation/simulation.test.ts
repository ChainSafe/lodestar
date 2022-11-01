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
import {CLClient, CreateNodePairResult, ELClient} from "../utils/simulation/interfaces.js";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {getEstimatedTimeInSecForRun, logFilesDir, SIM_TESTS_SECONDS_PER_SLOT} from "../utils/simulation/utils.js";

const runTill = 6;

describe("simulation test - multi-fork", function () {
  this.timeout(
    `${getEstimatedTimeInSecForRun({
      genesisSlotDelay: SLOTS_PER_EPOCH * 2,
      secondsPerSlot: SIM_TESTS_SECONDS_PER_SLOT,
      runTill: runTill + 1,
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
        GENESIS_DELAY: SLOTS_PER_EPOCH * 2,
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

  for (let epoch = 0; epoch <= runTill; epoch += 1) {
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
    let rangeSync: CreateNodePairResult;
    let checkpointSync: CreateNodePairResult;

    before(async () => {
      const {
        data: {finalized},
      } = await env.nodes[0].cl.api.beacon.getStateFinalityCheckpoints("head");

      const rangeSync = env.createClientPair({
        id: "range-sync-node",
        cl: CLClient.Lodestar,
        el: ELClient.Geth,
        keysCount: 0,
      });

      const checkpointSync = env.createClientPair({
        id: "range-sync-node",
        cl: CLClient.Lodestar,
        el: ELClient.Geth,
        keysCount: 0,
        wssCheckpoint: `${finalized.root}:${finalized.epoch}`,
      });

      await rangeSync.el.job.start();
      await rangeSync.cl.job.start();
      await env.network.connectNewNode({id: rangeSync.id, cl: rangeSync.cl.node, el: rangeSync.el.node});

      await checkpointSync.el.job.start();
      await checkpointSync.cl.job.start();
      await env.network.connectNewNode({id: checkpointSync.id, cl: checkpointSync.cl.node, el: checkpointSync.el.node});
    });

    after(async () => {
      await rangeSync.el.job.stop();
      await rangeSync.cl.job.stop();
      await checkpointSync.el.job.stop();
      await checkpointSync.cl.job.stop();
    });

    it("should sync the nodes", async () => {
      await Promise.all([
        nodeSyncedAssertions(
          env,
          {id: rangeSync.id, cl: rangeSync.cl.node, el: rangeSync.el.node},
          env.clock.getLastSlotOfEpoch(runTill + 1)
        ),
        nodeSyncedAssertions(
          env,
          {id: checkpointSync.id, cl: checkpointSync.cl.node, el: checkpointSync.el.node},
          env.clock.getLastSlotOfEpoch(runTill + 1)
        ),
      ]);
    });
  });
});
