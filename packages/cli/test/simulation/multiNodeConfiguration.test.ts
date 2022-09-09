import {nodeAssertions} from "../utils/simulation/assertions.js";
import {logFilesDir, SimulationEnvironment} from "../utils/simulation/index.js";

describe("multiNodeConfiguration", function () {
  this.timeout("5m");
  const env = new SimulationEnvironment({
    beaconNodes: 4,
    validatorClients: 1,
    validatorsPerClient: 16,
    // Use a larger value instead of Infinity
    // https://github.com/ChainSafe/lodestar/issues/4505
    altairEpoch: 10 ** 12,
    // Use a larger value instead of Infinity
    // https://github.com/ChainSafe/lodestar/issues/4505
    bellatrixEpoch: 10 ** 12,
    logFilesDir: `${logFilesDir}/multiNodeConfiguration`,
  });

  before(async function () {
    await env.start();
    await env.waitForEndOfSlot(0);
  });

  after(async () => {
    await env.stop();
  });

  describe("node assertions", () => {
    nodeAssertions(env);
  });
});
