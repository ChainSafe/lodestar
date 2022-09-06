import {SimulationEnvironment} from "../utils/simulation/index.js";
import {missedBlocksAssertions, participationAssertions} from "../utils/simulation/assertions.js";

const epochLimit = 5;

describe("singleNodeSingleValidatorMultipleEpoch", function () {
  this.timeout("5m");

  const env = new SimulationEnvironment({
    beaconNodes: 1,
    validatorClients: 1,
    validatorsPerClient: 128,
    // We need to use the attesting participation so have to switch to altair
    altairEpoch: 1,
    // Use a larger value instead of Infinity
    // https://github.com/ChainSafe/lodestar/issues/4505
    bellatrixEpoch: 10 ** 12,
  });

  before(async function () {
    await env.start();
  });

  after(async () => {
    await env.stop();
  });

  for (let i = 2; i <= epochLimit; i++) {
    describe(`epoch - ${i}`, () => {
      before(`wait for epoch ${i}`, async () => {
        // Wait for one extra slot to make sure the epoch transition is complete
        await env.clock.waitForEndOfSlot(env.clock.getLastSlotOfEpoch(i) + 1);
      });

      missedBlocksAssertions(env);
      participationAssertions(env);
    });
  }
});
