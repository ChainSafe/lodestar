import {parentPort, workerData} from "worker_threads";

import {initBLS} from "@chainsafe/bls";
import {consoleTransport, LogLevel, WinstonLogger} from "@chainsafe/lodestar-utils";

import {getDevBeaconNode} from "../../utils/node/beacon";
import {getDevValidator} from "../../utils/node/validator";

(async function () {
  await initBLS();

  const {
    nodeIndex,
    validatorsPerNode,
    startIndex,
  } = workerData.options;

  const logger = new WinstonLogger({
    level: LogLevel.debug
  }, [
    consoleTransport,
    // fileTransport(path.join(__dirname, "./node_" + nodeIndex + ".log"))
  ]);
  const node = await getDevBeaconNode({
    ...workerData.options,
    options: {
      logger: {
        // chain: {
        //   level: LogLevel.debug
        // },
        // api: {
        //   level: LogLevel.verbose
        // },
        // network: {
        //   level: LogLevel.debug
        // },
        // sync: {
        //   level: LogLevel.debug
        // },
        // node: {
        //   level: LogLevel.debug
        // }
      }
    },
    logger: logger.child({module: `Node ${nodeIndex}`})
  });

  const validator = getDevValidator({
    node,
    startIndex,
    count: validatorsPerNode,
    logger: logger.child({module: `Validator ${startIndex}-${startIndex+validatorsPerNode}`}),
  });

  await node.start();
  await validator.start();

  node.chain.on("justifiedCheckpoint", () => {
    parentPort.postMessage({
      event: "justifiedCheckpoint"
    });
  });
})();
