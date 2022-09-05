import {SimulationEnvironment} from "../utils/simulation/index.js";
import {missedBlocksAssertions, nodeAssertions, participationAssertions} from "../utils/simulation/assertions.js";

describe("Run single node, single validator, 128 interop validators (no eth1)", function () {
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
    await env.clock.waitForEndOfEpoch(2);
  });

  after(async () => {
    await env.stop();
  });

  nodeAssertions(env);
  missedBlocksAssertions(env);
  participationAssertions(env);
});
