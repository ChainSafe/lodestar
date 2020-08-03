import {parentPort, workerData} from "worker_threads";

import {initBLS} from "@chainsafe/bls";
import {WinstonLogger} from "@chainsafe/lodestar-utils";

import {getDevBeaconNode} from "../../utils/node/beacon";
import {getDevValidator} from "../../utils/node/validator";

(async function () {
  await initBLS();

  const {
    index,
    validatorsPerNode,
    startIndex,
  } = workerData.options;

  const logger = new WinstonLogger();
  const node = await getDevBeaconNode({
    ...workerData.options,
    logger: logger.child({module: `Node ${index}`})
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
    validator.stop().then(() =>
      node.stop().then(() =>
        parentPort.postMessage({
          event: "justifiedCheckpoint",
        })
      )
    );
  });
})();
