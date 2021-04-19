/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
// NOTE: @typescript*no-unsafe* rules are disabled above because `workerData` is typed as `any`
import {parentPort, workerData} from "worker_threads";

import {init} from "@chainsafe/bls";
import {phase0} from "@chainsafe/lodestar-types";

import {getDevBeaconNode} from "../../utils/node/beacon";
import {getDevValidators} from "../../utils/node/validator";
import {testLogger, LogLevel} from "../../utils/logger";
import {connect} from "../../utils/network";
import {Network} from "../../../src/network";
import {NodeWorkerOptions, Message} from "./types";
import Multiaddr from "multiaddr";
import {sleep, withTimeout} from "@chainsafe/lodestar-utils";
import {fromHexString} from "@chainsafe/ssz";
import {createFromPrivKey} from "peer-id";
import {simTestInfoTracker} from "../../utils/node/simTest";

/* eslint-disable no-console */

async function runWorker(): Promise<void> {
  const parent = parentPort;
  if (!parent) throw Error("Must be run in worker_thread");

  // blst Native bindings don't work right on worker threads. It errors with
  // (node:1692547) UnhandledPromiseRejectionWarning: Error: Module did not self-register: '/home/cayman/Code/bls/node_modules/@chainsafe/blst/prebuild/linux-x64-72-binding.node'.
  // Related issue: https://github.com/nodejs/node/issues/21783#issuecomment-429637117
  await init("blst-native");

  const options = workerData.options as NodeWorkerOptions;
  const {nodeIndex, validatorsPerNode, startIndex, checkpointEvent, logFile, nodes} = options;

  const loggerNode = testLogger(`Node ${nodeIndex}`, LogLevel.info, logFile);
  loggerNode.info("Thread started", {
    now: Math.floor(Date.now() / 1000),
    genesisTime: options.genesisTime,
    localMultiaddrs: options.options.network?.localMultiaddrs || [],
  });

  const node = await getDevBeaconNode({
    params: options.params,
    options: options.options,
    validatorCount: options.validatorCount,
    genesisTime: options.genesisTime,
    logger: loggerNode,
    peerId: await createFromPrivKey(fromHexString(options.peerIdPrivkey)),
  });

  // Only run for the first node
  const stopInfoTracker = nodeIndex === 0 ? simTestInfoTracker(node, loggerNode) : null;

  const validators = getDevValidators({
    node,
    validatorClientCount: 1,
    validatorsPerClient: validatorsPerNode,
    startIndex,
    logLevel: LogLevel.info,
    logFile,
  });

  await Promise.all(validators.map((validator) => validator.start()));

  // wait a bit before attempting to connect to the nodes
  const waitMsBeforeConnecting = Math.max(0, (1000 * options.genesisTime - Date.now()) / 2);
  loggerNode.info(`Waiting ${waitMsBeforeConnecting} ms before connecting to nodes...`);
  await sleep(waitMsBeforeConnecting);

  await Promise.all(
    nodes.map(async (nodeToConnect, i) => {
      if (i === nodeIndex) return; // Don't dial self
      loggerNode.info(`Connecting node ${nodeIndex} -> ${i}`);
      const multiaddrs = nodeToConnect.localMultiaddrs.map(Multiaddr);
      const peerIdToConn = await createFromPrivKey(fromHexString(nodeToConnect.peerIdPrivkey));
      await withTimeout(() => connect(node.network as Network, peerIdToConn, multiaddrs), 10 * 1000);
      loggerNode.info(`Connected node ${nodeIndex} -> ${i}`);
    })
  );

  node.chain.emitter.on(checkpointEvent, async (checkpoint) => {
    await Promise.all(validators.map((validator) => validator.stop()));
    if (stopInfoTracker) stopInfoTracker();
    await node.close();
    parent.postMessage({
      event: checkpointEvent,
      checkpoint: node.config.types.phase0.Checkpoint.toJson(checkpoint as phase0.Checkpoint),
    } as Message);
  });
}

runWorker().catch((e) => {
  console.error("Worker error", e);
  process.exit(1);
});
