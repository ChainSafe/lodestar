import {expect} from "chai";
import {phase0} from "@lodestar/types";
import {ChainEvent} from "@lodestar/beacon-node/chain";
import {createSimulationEnvironment, SimulationEnvironment, waitForEvent} from "../utils/simulation/index.js";

describe("singleNodeSingleThread", () => {
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
    // altair fork only
    {event: ChainEvent.finalized, altairEpoch: 0, bellatrixEpoch: Infinity},
    // altair fork at epoch 2
    {event: ChainEvent.finalized, altairEpoch: 2, bellatrixEpoch: Infinity},
    // bellatrix fork at epoch 0
    {event: ChainEvent.finalized, altairEpoch: 0, bellatrixEpoch: 0},

    // Remote signer with altair
    {event: ChainEvent.justified, altairEpoch: 0, bellatrixEpoch: Infinity, withExternalSigner: true},
  ];
  let env: SimulationEnvironment;

  afterEach(async () => {
    await env.stop();
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
      const env = await createSimulationEnvironment({
        validatorClientCount: 1,
        altairEpoch: 0,
        bellatrixEpoch: Infinity,
        chainEvent: ChainEvent.finalized,
      });
      this.timeout(env.simulationParams.expectedTimeout);

      await env.start();

      expect(env.beaconNodeEventInstrument.beaconNodes.length).to.equal(1);

      // Wait for test to complete
      await waitForEvent<phase0.Checkpoint>(
        env.beaconNodeEventInstrument.beaconNodes[0].chain.emitter,
        event,
        env.simulationParams.expectedTimeout
      );
    });
  }
});
