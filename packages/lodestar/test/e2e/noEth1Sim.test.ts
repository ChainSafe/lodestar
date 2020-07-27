import {IBeaconParams} from "@chainsafe/lodestar-params";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {getDevBeaconNode} from "../utils/node/beacon";
import {waitForEvent} from "../utils/events/resolver";
import {Checkpoint} from "@chainsafe/lodestar-types";
import {getDevValidator} from "../utils/node/validator";
import {Validator} from "@chainsafe/lodestar-validator/lib";
import {BeaconNode} from "../../src/node";

describe("no eth1 sim (multi-node test)", function () {

  const validatorsPerNode = 8;
  const beaconParams: Partial<IBeaconParams> = {
    SECONDS_PER_SLOT: 2,
    SLOTS_PER_EPOCH: 8
  };

  let onDoneHandlers: (() => Promise<void>)[] = [];

  for (const nodeCount of [2, 4]) {
    it(`Run ${nodeCount} nodes, ${validatorsPerNode} validators each until justified`, async function () {
      this.timeout("10 min");

      const nodes: BeaconNode[] = [];
      const validators: Validator[] = [];
      const genesisTime = Math.floor(Date.now() / 1000);
      const logger = new WinstonLogger();

      for (let i=0; i<nodeCount; i++) {
        const node = await getDevBeaconNode({
          params: beaconParams,
          options: {sync: {minPeers: 0}},
          validatorCount: nodeCount * validatorsPerNode,
          genesisTime,
          logger: logger.child({module: `Node ${i}`})
        });

        for (let j=0; j<validatorsPerNode; j++) {
          validators.push(getDevValidator({
            node,
            index: i * validatorsPerNode + j,
            logger: logger.child({module: `Validator ${i}-${j}`})
          }));
        }

        nodes.push(node);
      }

      onDoneHandlers.push(async () => {
        for (const node of nodes) {
          await node.stop();
        }
        for (const validator of validators) {
          await validator.stop();
        }
        // Wait a bit for nodes to shutdown
        await new Promise(r => setTimeout(r, 3000));
      });

      // Start all nodes at once
      await Promise.all(nodes.map(node => node.start()));

      // Connect all nodes with each other
      for (let i=0; i<nodeCount; i++) {
        for (let j=0; j<nodeCount; j++) {
          if (i !== j) {
            await nodes[i].network.connect(nodes[j].network.peerId, nodes[j].network.multiaddrs);
          }
        }
      }

      // Start all validators at once.
      await Promise.all(validators.map(validator => validator.start()));

      // Uncomment this to visualize validator dutties and attestations
      // printBeaconCliMetrics(nodes[0]);

      // Wait for finalized checkpoint on all nodes
      await Promise.all(nodes.map(node =>
        waitForEvent<Checkpoint>(node.chain, "justifiedCheckpoint", 240000)
      ));
    });
  }

  afterEach("Stop nodes and validators", async () => {
    for (const onDoneHandler of onDoneHandlers) {
      await onDoneHandler();
    }
    onDoneHandlers = [];
  });
});

