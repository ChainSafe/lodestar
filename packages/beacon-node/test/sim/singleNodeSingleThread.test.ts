import {phase0} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {ChainEvent} from "../../src/chain/index.js";
import {waitForEvent} from "../utils/events/resolver.js";
import {createSimulationEnvironment, SimulationEnvironment} from "../utils/simulation/index.js";

/* eslint-disable no-console, @typescript-eslint/naming-convention */

describe("Run single node single thread interop validators (no eth1) until checkpoint", async function () {
  let env: SimulationEnvironment;

  const testCases: {
    event: ChainEvent.justified | ChainEvent.finalized;
    altairEpoch: number;
    bellatrixEpoch: number;
    withExternalSigner: boolean;
  }[] = [
    // phase0 fork only
    {event: ChainEvent.finalized, altairEpoch: Infinity, bellatrixEpoch: Infinity, withExternalSigner: false},
    // altair fork only
    {event: ChainEvent.finalized, altairEpoch: 0, bellatrixEpoch: Infinity, withExternalSigner: false},
    // altair fork at epoch 2
    {event: ChainEvent.finalized, altairEpoch: 2, bellatrixEpoch: Infinity, withExternalSigner: false},
    // bellatrix fork at epoch 0
    {event: ChainEvent.finalized, altairEpoch: 0, bellatrixEpoch: 0, withExternalSigner: false},

    // Remote signer with altair
    {event: ChainEvent.justified, altairEpoch: 0, bellatrixEpoch: Infinity, withExternalSigner: true},
  ];

  for await (const {event, altairEpoch, bellatrixEpoch, withExternalSigner} of testCases) {
    env = await createSimulationEnvironment({
      chainEvent: event,
      altairEpoch,
      bellatrixEpoch,
      withExternalSigner,
      validatorClientCount: 1,
    });

    it(`singleNode ${env.simulationId}`, async function () {
      await env.start();

      // Wait for test to complete
      await waitForEvent<phase0.Checkpoint>(env.beaconNode.chain.emitter, event, env.simulationParams.expectedTimeout);

      console.log(`\nGot event ${event}, stopping validators and nodes\n`);

      // wait for 1 slot
      await sleep(1 * env.simulationParams.secondsPerSlot * 1000);

      console.log("\n\nDone\n\n");
      await sleep(1000);

      await env.stop();
    });
  }
});
