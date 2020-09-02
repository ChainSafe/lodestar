import {IBeaconParams} from "@chainsafe/lodestar-params";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {getDevBeaconNode} from "../utils/node/beacon";
import {waitForEvent} from "../utils/events/resolver";
import {Checkpoint} from "@chainsafe/lodestar-types";
import {getDevValidator} from "../utils/node/validator";
import {Validator} from "@chainsafe/lodestar-validator/lib";
import {BeaconNode} from "../../src/node";

describe.skip("Run multi node single thread interop validators (no eth1) until checkpoint", function () {
  const checkpointEvent = "justified";
  const validatorsPerNode = 8;
  const beaconParams: Pick<IBeaconParams, "SECONDS_PER_SLOT" | "SLOTS_PER_EPOCH"> = {
    SECONDS_PER_SLOT: 3,
    SLOTS_PER_EPOCH: 8,
  };

  let onDoneHandlers: (() => Promise<void>)[] = [];

  for (const nodeCount of [2, 4]) {
    it(`${nodeCount} nodes / ${validatorsPerNode} vc / 1 validator > until ${checkpointEvent}`, async function () {
      this.timeout("10 min");

      const nodes: BeaconNode[] = [];
      const validators: Validator[] = [];
      // delay a bit so regular sync sees it's up to date and sync is completed from the beginning
      const minGenesisTime = Math.floor(Date.now() / 1000);
      const genesisDelay = 2 * beaconParams.SECONDS_PER_SLOT;
      const genesisTime = minGenesisTime + genesisDelay;
      const logger = new WinstonLogger();

      for (let i = 0; i < nodeCount; i++) {
        const node = await getDevBeaconNode({
          params: beaconParams,
          options: {sync: {minPeers: 1}},
          validatorCount: nodeCount * validatorsPerNode,
          genesisTime,
          logger: logger.child({module: `Node ${i}`}),
        });

        validators.push(
          getDevValidator({
            node,
            startIndex: i * validatorsPerNode,
            count: validatorsPerNode,
            logger: logger.child({
              module: `Validator ${i * validatorsPerNode}-${i * validatorsPerNode + validatorsPerNode}`,
            }),
          })
        );

        nodes.push(node);
      }

      onDoneHandlers.push(async () => {
        await Promise.all(validators.map((validator) => validator.stop()));
        logger.info("Stopped all validators");
        // wait for 1 slot
        await new Promise((r) => setTimeout(r, 1 * beaconParams.SECONDS_PER_SLOT * 1000));

        await Promise.all(nodes.map((node) => node.stop()));
        logger.info("Stopped all nodes");
        // Wait a bit for nodes to shutdown
        await new Promise((r) => setTimeout(r, 3000));
      });

      // Start all nodes at once
      await Promise.all(nodes.map((node) => node.start()));

      // Connect all nodes with each other
      for (let i = 0; i < nodeCount; i++) {
        for (let j = 0; j < nodeCount; j++) {
          if (i !== j) {
            await nodes[i].network.connect(nodes[j].network.peerId, nodes[j].network.localMultiaddrs);
          }
        }
      }

      // Start all validators at once.
      await Promise.all(validators.map((validator) => validator.start()));

      // Uncomment this to visualize validator dutties and attestations
      // printBeaconCliMetrics(nodes[0]);

      // Wait for justified checkpoint on all nodes
      await Promise.all(nodes.map((node) => waitForEvent<Checkpoint>(node.chain.emitter, checkpointEvent, 240000)));
      logger.info("All nodes reached justified checkpoint");
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
