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
import {CLClient, ELClient} from "../utils/simulation/interfaces.js";

const runTill = 6;

describe("simulation test - multi-fork", function () {
  this.timeout("10m");

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
      {id: "node1", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32},
      {id: "node2", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32},
      {id: "node3", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32},
      {id: "node4", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32},
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

  // describe("range sync from genesis", () => {
  //   let clParticipant: CLNode;
  //   let clJob: Job;
  //   const rangeSyncEpoch = runTill + 1;

  //   before(async () => {
  //     const {job, participant} = env.createCLClient(CLClient.Lodestar, env.nodes.length, {
  //       id: "range-sync-node",
  //       secretKeys: [],
  //     });
  //     clJob = job;
  //     clParticipant = participant;

  //     await clJob.start();
  //     await env.network.connectNewNode(clParticipant);

  //     env.tracker.track(clParticipant);
  //     // Wait for existing tests to finish
  //     await env.waitForSlot(env.clock.getLastSlotOfEpoch(rangeSyncEpoch) + 1);

  //     env.tracker.printNoesInfo(rangeSyncEpoch);
  //   });

  //   after(async () => {
  //     await clJob.stop();
  //   });

  //   describe("missed blocks", () => {
  //     missedBlocksAssertions(env, rangeSyncEpoch);
  //   });

  //   describe("finality", () => {
  //     finalityAssertions(env, rangeSyncEpoch);
  //   });

  //   describe("heads", () => {
  //     headsAssertions(env, rangeSyncEpoch);
  //   });
  // });

  // describe("checkpoint sync", () => {
  //   let clParticipant: CLNode;
  //   let clJob: Job;
  //   const checkpointSyncEpoch = runTill + 2;

  //   before(async () => {
  //     const {
  //       data: {finalized},
  //     } = await env.nodes[0].api.beacon.getStateFinalityCheckpoints("head");

  //     const {job, participant} = env.createCLClient(CLClient.Lodestar, env.nodes.length, {
  //       id: "checkpoint-sync-node",
  //       secretKeys: [],
  //       wssCheckpoint: `${finalized.root}:${finalized.epoch}`,
  //     });
  //     clJob = job;
  //     clParticipant = participant;

  //     await clJob.start();
  //     await env.network.connectNewNode(clParticipant);

  //     env.tracker.track(clParticipant);
  //     // Wait for existing tests to finish
  //     await env.waitForSlot(env.clock.getLastSlotOfEpoch(checkpointSyncEpoch) + 1);

  //     env.tracker.printNoesInfo(checkpointSyncEpoch);
  //   });

  //   after(async () => {
  //     await clJob.stop();
  //   });

  //   describe("missed blocks", () => {
  //     missedBlocksAssertions(env, checkpointSyncEpoch);
  //   });

  //   describe("finality", () => {
  //     finalityAssertions(env, checkpointSyncEpoch);
  //   });

  //   describe("heads", () => {
  //     headsAssertions(env, checkpointSyncEpoch);
  //   });
  // });
});
