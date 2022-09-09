import {logFilesDir, SimulationEnvironment} from "../utils/simulation/index.js";
import {missedBlocksAssertions, participationAssertions} from "../utils/simulation/assertions.js";

const epochLimit = 5;

describe("singleNodeSingleValidatorMultipleEpoch", function () {
  this.timeout("5m");
  let env: SimulationEnvironment;

  before(async function () {
    env = new SimulationEnvironment({
      beaconNodes: 1,
      validatorClients: 1,
      validatorsPerClient: 128,
      // We need to use the attesting participation so have to switch to altair
      altairEpoch: 0,
      // Use a larger value instead of Infinity
      // https://github.com/ChainSafe/lodestar/issues/4505
      bellatrixEpoch: 10 ** 12,
      logFilesDir: `${logFilesDir}/singleNodeSingleValidatorMultipleEpoch`,
    });

    await env.start();
  });

  after(async () => {
    await env.stop();
  });

  for (let i = 0; i < epochLimit; i++) {
    describe(`epoch - ${i}`, () => {
      before(`wait for epoch ${i}`, async () => {
        // Wait for one extra slot to make sure the epoch transition is complete
        await env.waitForEndOfSlot(env.clock.getLastSlotOfEpoch(i) + 1);
      });

      it("should not have missed blocks", () => {
        missedBlocksAssertions(env, env.clock.currentSlot);
      });

      it("should have correct participation on head", () => {
        participationAssertions(env, "HEAD");
      });

      it("should have correct participation on FFG", () => {
        participationAssertions(env, "FFG");
      });
    });
  }
});
