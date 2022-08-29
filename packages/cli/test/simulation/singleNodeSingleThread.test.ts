import {SimulationEnvironment} from "../utils/simulation/index.js";
import {
  feeRecipientsAssertions,
  finalityAssertions,
  forkAssertions,
  nodeAssertions,
  operationsAssertions,
  peersAssertions,
  slashingAssertions,
} from "../utils/simulation/assertions.js";

describe("Run single node single thread interop validators (no eth1) until checkpoint", function () {
  const validatorClientCount = 1;
  const validatorsPerClient = 32 * 4;

  const testCases: {
    altairEpoch: number;
    bellatrixEpoch: number;
  }[] = [
    // phase0 fork only
    {altairEpoch: Infinity, bellatrixEpoch: Infinity},
    // // altair fork only
    // { altairEpoch: 0, bellatrixEpoch: Infinity},
    // // altair fork at epoch 2
    // {altairEpoch: 2, bellatrixEpoch: Infinity},
    // // bellatrix fork at epoch 0
    // {altairEpoch: 0, bellatrixEpoch: 0},
  ];
  for (const {altairEpoch, bellatrixEpoch} of testCases) {
    this.timeout(30000);
    const env = new SimulationEnvironment({
      beaconNodes: 1,
      validatorClients: validatorClientCount,
      validatorsPerClient,
      altairEpoch,
      bellatrixEpoch,
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
  }
});
