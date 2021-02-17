import {IBeaconParams} from "@chainsafe/lodestar-params";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {getDevBeaconNode} from "../utils/node/beacon";
import {BeaconNode} from "../../src/node";

describe("Run multi node single thread", function () {
  const beaconParams: Pick<IBeaconParams, "SECONDS_PER_SLOT" | "SLOTS_PER_EPOCH"> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SECONDS_PER_SLOT: 3,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SLOTS_PER_EPOCH: 8,
  };

  let onDoneHandlers: (() => Promise<void>)[] = [];

  const nodeCount = 2;
  it(`${nodeCount} nodes, immediate shutdown`, async function () {
    this.timeout("1 min");

    const nodes: BeaconNode[] = [];
    // delay a bit so regular sync sees it's up to date and sync is completed from the beginning
    const minGenesisTime = Math.floor(Date.now() / 1000);
    const genesisDelay = 2 * beaconParams.SECONDS_PER_SLOT;
    const genesisTime = minGenesisTime + genesisDelay;
    const logger = new WinstonLogger();

    for (let i = 0; i < nodeCount; i++) {
      const node = await getDevBeaconNode({
        params: beaconParams,
        options: {sync: {minPeers: 1}},
        genesisTime,
        logger: logger.child({module: `Node ${i}`}),
      });
      nodes.push(node);
    }

    onDoneHandlers.push(async () => {
      await Promise.all(nodes.map((node) => node.close()));
      logger.info("Stopped all nodes");
      // Wait a bit for nodes to shutdown
      await new Promise((r) => setTimeout(r, 3000));
    });

    // Connect all nodes with each other
    for (let i = 0; i < nodeCount; i++) {
      for (let j = 0; j < nodeCount; j++) {
        if (i !== j) {
          await nodes[i].network.connect(nodes[j].network.peerId, nodes[j].network.localMultiaddrs);
        }
      }
    }

    await new Promise((r) => setTimeout(r, 1000));
  });

  afterEach("Stop nodes and validators", async function () {
    //this.timeout(20000);
    this.timeout(0);
    for (const onDoneHandler of onDoneHandlers) {
      await onDoneHandler();
    }
    onDoneHandlers = [];
  });
});
