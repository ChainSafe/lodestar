import {expect} from "chai";
import {ChainEvent} from "@lodestar/beacon-node/chain";
import {SimulationEnvironment} from "../utils/simulation/index.js";

describe("Run single node single thread interop validators (no eth1) until checkpoint", function () {
  const validatorClientCount = 1;
  const validatorsPerClient = 32 * 4;

  const testCases: {
    event: ChainEvent.justified | ChainEvent.finalized;
    altairEpoch: number;
    bellatrixEpoch: number;
    withExternalSigner?: boolean;
  }[] = [
    // phase0 fork only
    {event: ChainEvent.finalized, altairEpoch: Infinity, bellatrixEpoch: Infinity},
    // // altair fork only
    // {event: ChainEvent.finalized, altairEpoch: 0, bellatrixEpoch: Infinity},
    // // altair fork at epoch 2
    // {event: ChainEvent.finalized, altairEpoch: 2, bellatrixEpoch: Infinity},
    // // bellatrix fork at epoch 0
    // {event: ChainEvent.finalized, altairEpoch: 0, bellatrixEpoch: 0},

    // // Remote signer with altair
    // {event: ChainEvent.justified, altairEpoch: 0, bellatrixEpoch: Infinity, withExternalSigner: true},
  ];
  let env: SimulationEnvironment;

  afterEach(async () => {
    if (env !== undefined) {
      await env.stop();
    }
  });

  for (const {event, altairEpoch, bellatrixEpoch, withExternalSigner} of testCases) {
    const testIdStr = [
      `altair-${altairEpoch}`,
      `bellatrix-${bellatrixEpoch}`,
      `vc-${validatorClientCount}`,
      `vPc-${validatorsPerClient}`,
      withExternalSigner ? "external_signer" : "local_signer",
      `event-${event}`,
    ].join("_");

    it(`singleNode ${testIdStr}`, async function () {
      this.timeout(30000);
      env = new SimulationEnvironment({
        beaconNodes: 1,
        validatorClients: validatorClientCount,
        validatorsPerClient,
        altairEpoch,
        bellatrixEpoch,
        chainEvent: event,
      });

      await env.start();

      expect(env).to.not.be.null;

      await new Promise((resolve) => {
        setTimeout(resolve, 20000);
      });
    });
  }
});
