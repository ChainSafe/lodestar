import {missedBlocksAssertions, nodeAssertions, participationAssertions} from "../utils/simulation/assertions.js";
import {SimulationEnvironment} from "../utils/simulation/index.js";

describe("Run four nodes, single validator per node, 32 interop validators (no eth1)", function () {
  this.timeout("5m");

  const env = new SimulationEnvironment({
    beaconNodes: 4,
    validatorClients: 1,
    validatorsPerClient: 32,
    // We need to use the attesting participation so have to switch to altair
    altairEpoch: 1,
    // Use a larger value instead of Infinity
    // https://github.com/ChainSafe/lodestar/issues/4505
    bellatrixEpoch: 10 ** 12,
  });

  before(async function () {
    await env.start();
    await env.connectAllNodes();
    await env.clock.waitForEndOfEpoch(2);
  });

  after(async () => {
    await env.stop();
  });

  nodeAssertions(env);
  missedBlocksAssertions(env);
  participationAssertions(env);
});
