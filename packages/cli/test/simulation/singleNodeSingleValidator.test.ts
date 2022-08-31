import {SimulationEnvironment} from "../utils/simulation/index.js";
import {
  feeRecipientsAssertions,
  finalityAssertions,
  forkAssertions,
  missedBlocksAssertions,
  nodeAssertions,
  operationsAssertions,
  participationAssertions,
  peersAssertions,
  slashingAssertions,
} from "../utils/simulation/assertions.js";

describe("Run single node, single validator, 128 interop validators (no eth1)", function () {
  this.timeout("5m");

  const env = new SimulationEnvironment({
    beaconNodes: 1,
    validatorClients: 1,
    validatorsPerClient: 128,
    altairEpoch: Infinity,
    bellatrixEpoch: Infinity,
  });

  before(async function () {
    await env.start();
  });

  after(async () => {
    await env.stop();
  });

  feeRecipientsAssertions(env);
  finalityAssertions(env);
  forkAssertions(env);
  nodeAssertions(env);
  operationsAssertions(env);
  peersAssertions(env);
  slashingAssertions(env);
  participationAssertions(env);
  missedBlocksAssertions(env);
});
