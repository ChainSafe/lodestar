import {SimulationEnvironment} from "../utils/simulation/index.js";
import {forkAssertions} from "../utils/simulation/assertions.js";

describe("Run single node - fork tests", function () {
  this.timeout("5m");

  const env = new SimulationEnvironment({
    beaconNodes: 1,
    validatorClients: 1,
    validatorsPerClient: 128,
    altairEpoch: 1,
    bellatrixEpoch: 2,
  });

  before(async function () {
    await env.start();
  });

  after(async () => {
    await env.stop();
  });

  forkAssertions(env);
});
