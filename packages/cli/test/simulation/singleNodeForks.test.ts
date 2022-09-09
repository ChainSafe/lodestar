import {expect} from "chai";
import {logFilesDir, SimulationEnvironment} from "../utils/simulation/index.js";

describe("singleNodeForks", function () {
  this.timeout("5m");
  let env: SimulationEnvironment;

  before(async function () {
    env = new SimulationEnvironment({
      beaconNodes: 1,
      validatorClients: 1,
      validatorsPerClient: 128,
      altairEpoch: 1,
      bellatrixEpoch: 2,
      logFilesDir: `${logFilesDir}/singleNodeForks`,
    });
    await env.start();
  });

  after(async () => {
    await env.stop();
  });

  describe("altair fork", () => {
    it("should occur on right slot", async () => {
      const node = env.nodes[0];

      const expectedSlot = env.params.altairEpoch * env.params.slotsPerEpoch;
      await env.waitForEndOfSlot(expectedSlot);

      const state = await node.api.debug.getStateV2(expectedSlot.toString());
      expect(state.version).to.equal("altair");
    });
  });

  describe("bellatrix fork", () => {
    it("should occur on right slot", async () => {
      const node = env.nodes[0];

      const expectedSlot = env.params.bellatrixEpoch * env.params.slotsPerEpoch;
      await env.waitForEndOfSlot(expectedSlot);

      const state = await node.api.debug.getStateV2(expectedSlot.toString());
      expect(state.version).to.equal("bellatrix");
    });
  });
});
