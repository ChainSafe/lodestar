import {nodeAssertions} from "../utils/simulation/assertions.js";
import {SimulationEnvironment} from "../utils/simulation/index.js";

describe("multiNodeConfiguration", function () {
  this.timeout("5m");

  const env = new SimulationEnvironment({
    beaconNodes: 4,
    validatorClients: 2,
    validatorsPerClient: 16,
    // Use a larger value instead of Infinity
    // https://github.com/ChainSafe/lodestar/issues/4505
    altairEpoch: 10 ** 12,
    // Use a larger value instead of Infinity
    // https://github.com/ChainSafe/lodestar/issues/4505
    bellatrixEpoch: 10 ** 12,
  });

  before(async function () {
    await env.start();
    await env.waitForEndOfSlot(0);
  });

  after(async () => {
    await env.stop();
  });

  nodeAssertions(env);
});
