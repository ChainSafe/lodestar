import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {routes} from "@lodestar/api/beacon";
import {logFilesDir, SimulationEnvironment, FAR_FUTURE_EPOCH} from "../utils/simulation/index.js";
import {
  missedBlocksAssertions,
  attestationParticipationAssertions,
  nodeAssertions,
} from "../utils/simulation/assertions.js";

chai.use(chaiAsPromised);

describe("singleNodeSingleValidator", function () {
  this.timeout("5m");
  let env: SimulationEnvironment;

  const forksCases: {
    title: string;
    params: {
      altairEpoch: number;
      bellatrixEpoch: number;
      withExternalSigner?: boolean;
    };
  }[] = [
    {
      title: "phase0 fork only",
      params: {
        altairEpoch: FAR_FUTURE_EPOCH,
        bellatrixEpoch: FAR_FUTURE_EPOCH,
      },
    },
    {
      title: "altair fork only",
      params: {altairEpoch: 0, bellatrixEpoch: FAR_FUTURE_EPOCH},
    },
    {
      title: "altair fork at epoch 2",
      params: {altairEpoch: 2, bellatrixEpoch: FAR_FUTURE_EPOCH},
    },
    // {
    //   title: "bellatrix fork at epoch 0",
    //   params: {event: routes.events.EventType.finalizedCheckpoint, altairEpoch: 0, bellatrixEpoch: 0},
    // },
    {
      title: "Remote signer with altair",
      params: {
        altairEpoch: 0,
        bellatrixEpoch: FAR_FUTURE_EPOCH,
        withExternalSigner: true,
      },
    },
  ];

  for (const {
    title,
    params: {altairEpoch, bellatrixEpoch, withExternalSigner},
  } of forksCases) {
    const testIdStr = [
      `altair-${altairEpoch}`,
      `bellatrix-${bellatrixEpoch}`,
      `externalSigner-${withExternalSigner ? "yes" : "no"}`,
    ].join("_");

    describe(title, async () => {
      before("setup env", () => {
        env = new SimulationEnvironment({
          beaconNodes: 1,
          validatorClients: 1,
          validatorsPerClient: 128,
          altairEpoch,
          bellatrixEpoch,
          logFilesDir: `${logFilesDir}/singleNodeForks/${testIdStr}`,
          externalSigner: withExternalSigner,
        });
      });

      before("start env", async () => {
        await env.start();
      });

      after("stop env", async () => {
        await env.stop();
      });

      before("node has proper status and keys", async () => {
        await expect(nodeAssertions(env)).be.fulfilled;
      });

      before("should reach to finality", async () => {
        await expect(env.waitForEvent(routes.events.EventType.finalizedCheckpoint, env.nodes[0])).be.fulfilled;
      });

      it("should not have missed blocks", () => {
        env.tracker.printMissedBlocks();

        missedBlocksAssertions(env);
      });

      it("should have correct attestation participation", () => {
        env.tracker.printAttestationsParticipation();

        attestationParticipationAssertions(env);
      });
    });
  }
});
