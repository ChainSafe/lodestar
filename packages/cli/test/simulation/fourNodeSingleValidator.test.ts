import {nodeAssertions} from "../utils/simulation/assertions.js";
import {FAR_FUTURE_EPOCH, logFilesDir, SimulationEnvironment} from "../utils/simulation/index.js";

// TODO: Enable these back after fixing the issue with peer connection and `Error: PublishError.Duplicate`
describe.skip("Run four nodes, single validator per node, 32 interop validators (no eth1)", function () {
  this.timeout("5m");

  const env = new SimulationEnvironment({
    beaconNodes: 4,
    validatorClients: 1,
    validatorsPerClient: 32,
    // We need to use the attesting participation so have to switch to altair
    altairEpoch: 1,
    /** Use a larger value instead of Infinity
     * https://github.com/ChainSafe/lodestar/issues/4505
     */
    bellatrixEpoch: FAR_FUTURE_EPOCH,
    logFilesDir: `${logFilesDir}/fourNodeSingleValidator`,
  });

  before(async function () {
    await env.start();
    await env.network.connectAllNodes();
    await env.waitForEndOfEpoch(2);
  });

  after(async () => {
    await env.stop();
  });

  describe("node assertions", () => {
    nodeAssertions(env);
  });
});
