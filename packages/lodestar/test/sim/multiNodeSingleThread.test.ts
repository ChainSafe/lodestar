import {IBeaconParams} from "@chainsafe/lodestar-params";
import {Network} from "../../src/network";
import {getDevBeaconNode} from "../utils/node/beacon";
import {waitForEvent} from "../utils/events/resolver";
import {phase0} from "@chainsafe/lodestar-types";
import {getDevValidator} from "../utils/node/validator";
import {Validator} from "@chainsafe/lodestar-validator/lib";
import {BeaconNode} from "../../src/node";
import {ChainEvent} from "../../src/chain";
import {testLogger, LogLevel} from "../utils/logger";
import {connect} from "../utils/network";
import {logFiles} from "./params";

/* eslint-disable no-console */

describe("Run multi node single thread interop validators (no eth1) until checkpoint", function () {
  const checkpointEvent = ChainEvent.justified;
  const validatorsPerNode = 8;
  const beaconParams: Pick<IBeaconParams, "SECONDS_PER_SLOT" | "SLOTS_PER_EPOCH"> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SECONDS_PER_SLOT: 3,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SLOTS_PER_EPOCH: 8,
  };

  let onDoneHandlers: (() => Promise<void>)[] = [];

  for (const nodeCount of [4]) {
    it(`${nodeCount} nodes / ${validatorsPerNode} vc / 1 validator > until ${checkpointEvent}`, async function () {
      this.timeout("10 min");

      const nodes: BeaconNode[] = [];
      const validators: Validator[] = [];
      // delay a bit so regular sync sees it's up to date and sync is completed from the beginning
      const minGenesisTime = Math.floor(Date.now() / 1000);
      const genesisDelay = 2 * beaconParams.SECONDS_PER_SLOT;
      const genesisTime = minGenesisTime + genesisDelay;

      for (let i = 0; i < nodeCount; i++) {
        const logger = testLogger(`Node ${i}`, LogLevel.info, logFiles.multinodeSinglethread);
        const node = await getDevBeaconNode({
          params: beaconParams,
          options: {sync: {minPeers: 1}},
          validatorCount: nodeCount * validatorsPerNode,
          genesisTime,
          logger,
        });

        const startIndex = i * validatorsPerNode;
        const endIndex = i * validatorsPerNode + validatorsPerNode - 1;
        validators.push(
          getDevValidator({
            node,
            startIndex,
            count: validatorsPerNode,
            logger: logger.child({
              module: `Vali ${startIndex}-${endIndex}`,
            }),
          })
        );

        nodes.push(node);
      }

      onDoneHandlers.push(async () => {
        await Promise.all(validators.map((validator) => validator.stop()));
        console.log("--- Stopped all validators ---");
        // wait for 1 slot
        await new Promise((r) => setTimeout(r, 1 * beaconParams.SECONDS_PER_SLOT * 1000));

        await Promise.all(nodes.map((node) => node.close()));
        console.log("--- Stopped all nodes ---");
        // Wait a bit for nodes to shutdown
        await new Promise((r) => setTimeout(r, 3000));
      });

      // Connect all nodes with each other
      for (let i = 0; i < nodeCount; i++) {
        for (let j = 0; j < nodeCount; j++) {
          if (i !== j) {
            await connect(nodes[i].network as Network, nodes[j].network.peerId, nodes[j].network.localMultiaddrs);
          }
        }
      }

      // Start all validators at once.
      await Promise.all(validators.map((validator) => validator.start()));

      // Wait for justified checkpoint on all nodes
      await Promise.all(
        nodes.map((node) => waitForEvent<phase0.Checkpoint>(node.chain.emitter, checkpointEvent, 240000))
      );
      console.log("--- All nodes reached justified checkpoint ---");
    });
  }

  afterEach("Stop nodes and validators", async function () {
    this.timeout(20000);
    for (const onDoneHandler of onDoneHandlers) {
      await onDoneHandler();
    }
    onDoneHandlers = [];
  });
});
