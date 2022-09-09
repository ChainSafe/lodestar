import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {routes} from "@lodestar/api/beacon";
import {logFilesDir, SimulationEnvironment, FAR_FUTURE_EPOCH} from "../utils/simulation/index.js";

chai.use(chaiAsPromised);

describe("singleNodeForks", function () {
  this.timeout("5m");
  let env: SimulationEnvironment;

  const testCases: {
    title: string;
    params: {
      event: routes.events.EventType;
      altairEpoch: number;
      bellatrixEpoch: number;
      withExternalSigner?: boolean;
    };
  }[] = [
    {
      title: "phase0 fork only",
      params: {
        event: routes.events.EventType.finalizedCheckpoint,
        altairEpoch: FAR_FUTURE_EPOCH,
        bellatrixEpoch: FAR_FUTURE_EPOCH + 10,
      },
    },
    {
      title: "altair fork only",
      params: {event: routes.events.EventType.finalizedCheckpoint, altairEpoch: 0, bellatrixEpoch: FAR_FUTURE_EPOCH},
    },
    {
      title: "altair fork at epoch 2",
      params: {event: routes.events.EventType.finalizedCheckpoint, altairEpoch: 2, bellatrixEpoch: FAR_FUTURE_EPOCH},
    },
    // {
    //   title: "bellatrix fork at epoch 0",
    //   params: {event: routes.events.EventType.finalizedCheckpoint, altairEpoch: 0, bellatrixEpoch: 0},
    // },
    {
      title: "Remote signer with altair",
      params: {
        event: routes.events.EventType.finalizedCheckpoint,
        altairEpoch: 0,
        bellatrixEpoch: Infinity,
        withExternalSigner: true,
      },
    },
  ];

  for (const {
    title,
    params: {event, altairEpoch, bellatrixEpoch, withExternalSigner},
  } of testCases) {
    const testIdStr = [
      `altair-${altairEpoch}`,
      `bellatrix-${bellatrixEpoch}`,
      `externalSigner-${withExternalSigner ? "yes" : "no"}`,
    ].join("_");

    describe(title, () => {
      before(async function () {
        env = new SimulationEnvironment({
          beaconNodes: 1,
          validatorClients: 1,
          validatorsPerClient: 128,
          altairEpoch,
          bellatrixEpoch,
          logFilesDir: `${logFilesDir}/singleNodeForks/${testIdStr}`,
          externalSigner: withExternalSigner,
        });
        await env.start();
      });

      after(async () => {
        await env.stop();
      });

      it("should reach to finality", async () => {
        await expect(env.waitForEvent(event, env.nodes[0])).be.fulfilled;
      });
    });
  }
});
