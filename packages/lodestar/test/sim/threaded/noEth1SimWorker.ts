/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
// NOTE: @typescript*no-unsafe* rules are disabled above because `workerData` is typed as `any`
import {parentPort, workerData} from "worker_threads";

import {init} from "@chainsafe/bls";
import {phase0} from "@chainsafe/lodestar-types";

import {getDevBeaconNode} from "../../utils/node/beacon";
import {getDevValidator} from "../../utils/node/validator";
import {testLogger, LogLevel} from "../../utils/logger";

(async function () {
  // blst Native bindings don't work right on worker threads. It errors with
  // (node:1692547) UnhandledPromiseRejectionWarning: Error: Module did not self-register: '/home/cayman/Code/bls/node_modules/@chainsafe/blst/prebuild/linux-x64-72-binding.node'.
  // Related issue: https://github.com/nodejs/node/issues/21783#issuecomment-429637117
  await init("herumi");

  const {nodeIndex, validatorsPerNode, startIndex, checkpointEvent, logFile} = workerData.options;
  const endIndex = startIndex + validatorsPerNode - 1;

  const node = await getDevBeaconNode({
    ...workerData.options,
    logger: testLogger(`Node ${nodeIndex}`, LogLevel.info, logFile),
  });

  const validator = getDevValidator({
    node,
    startIndex,
    count: validatorsPerNode,
    logger: testLogger(`Vali ${startIndex}-${endIndex}`, LogLevel.info, logFile),
  });

  await validator.start();

  node.chain.emitter.on(checkpointEvent, (checkpoint) => {
    validator.stop().then(() =>
      node.close().then(() => {
        parentPort!.postMessage({
          event: checkpointEvent,
          checkpoint: node.config.types.phase0.Checkpoint.toJson(checkpoint as phase0.Checkpoint),
        });
      })
    );
  });
})();
