import {parentPort, workerData} from "worker_threads";

import {initBLS} from "@chainsafe/bls";
import {Checkpoint} from "@chainsafe/lodestar-types";
import {WinstonLogger} from "@chainsafe/lodestar-utils";

import {getDevBeaconNode} from "../../utils/node/beacon";
import {getDevValidator} from "../../utils/node/validator";

(async function () {
  await initBLS();

  const {nodeIndex, validatorsPerNode, startIndex, checkpointEvent} = workerData.options;

  const logger = new WinstonLogger();
  const node = await getDevBeaconNode({
    ...workerData.options,
    logger: logger.child({module: `Node ${nodeIndex}`}),
  });

  await node.start();

  const validator = getDevValidator({
    node,
    startIndex,
    count: validatorsPerNode,
    logger: logger.child({module: `Validator ${startIndex}-${startIndex + validatorsPerNode}`}),
  });
  await validator.start();

  node.chain.emitter.on(checkpointEvent, (checkpoint) => {
    validator.stop().then(() =>
      node.stop().then(() => {
        parentPort!.postMessage({
          event: checkpointEvent,
          checkpoint: node.config.types.Checkpoint.toJson(checkpoint as Checkpoint),
        });
      })
    );
  });
})();
