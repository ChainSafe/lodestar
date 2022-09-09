import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {routes} from "@lodestar/api/beacon";
import {logFilesDir, SimulationEnvironment, FAR_FUTURE_EPOCH} from "../utils/simulation/index.js";

chai.use(chaiAsPromised);

describe("fourNodesForks", function () {
  this.timeout("5m");
  let env: SimulationEnvironment;

  const testCases: {
    title: string;
    params: {
      event: routes.events.EventType;
      altairEpoch: number;
      bellatrixEpoch: number;
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
  ];

  for (const {
    title,
    params: {event, altairEpoch, bellatrixEpoch},
  } of testCases) {
    const testIdStr = [`altair-${altairEpoch}`, `bellatrix-${bellatrixEpoch}`].join("_");

    describe(title, () => {
      before(async function () {
        env = new SimulationEnvironment({
          beaconNodes: 4,
          validatorClients: 1,
          validatorsPerClient: 32,
          altairEpoch,
          bellatrixEpoch,
          logFilesDir: `${logFilesDir}/fourNodesForks/${testIdStr}`,
        });
        await env.start();
        await env.network.connectAllNodes();
      });

      after(async () => {
        await env.stop();
      });

      it("all nodes should reach to finality", async () => {
        await expect(Promise.all(env.nodes.map((node) => env.waitForEvent(event, node)))).be.fulfilled;
      });
    });
  }
});
