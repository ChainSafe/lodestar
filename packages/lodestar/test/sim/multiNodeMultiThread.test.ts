import path from "node:path";
import os from "node:os";
import {Worker} from "worker_threads";
import {phase0} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {waitForEvent} from "../utils/events/resolver";
import {ChainEvent} from "../../src/chain";
import {createPeerId} from "../../src/network";
import {logFilesDir} from "./params";
import {NodeWorkerOptions} from "./threaded/types";
import {IChainConfig} from "@chainsafe/lodestar-config";

/* eslint-disable no-console, @typescript-eslint/naming-convention */

type TestArgs = {
  nodeCount: number;
  validatorsPerNode: number;
  event: ChainEvent.justified;
  altairForkEpoch: number;
};

const testParams: Pick<IChainConfig, "SECONDS_PER_SLOT"> = {
  SECONDS_PER_SLOT: 2,
};

describe("Run multi node multi thread interop validators (no eth1) until checkpoint", function () {
  // Test phase0 to justification
  const phase0Case = {altairForkEpoch: Infinity};
  // Test altair only
  const altairGenCase = {altairForkEpoch: 0};
  // Test phase -> altair fork transition
  const altairEph2Case = {altairForkEpoch: 2};

  const {RUN_ONLY_SIM_TEST} = process.env;
  const testCases =
    RUN_ONLY_SIM_TEST === "phase0"
      ? [phase0Case]
      : RUN_ONLY_SIM_TEST === "altair-genesis"
      ? [altairGenCase]
      : RUN_ONLY_SIM_TEST === "altair-epoch2"
      ? [altairEph2Case]
      : // if RUN_ONLY_SIM_TEST is not set or else run all tests
        [phase0Case, altairGenCase, altairEph2Case];

  for (const testCase of testCases) {
    runMultiNodeMultiThreadTest({
      nodeCount: 4,
      validatorsPerNode: 8,
      event: ChainEvent.justified,
      altairForkEpoch: testCase.altairForkEpoch,
    });
  }
});

function runMultiNodeMultiThreadTest({nodeCount, validatorsPerNode, event, altairForkEpoch}: TestArgs): void {
  it(`multiThread ${nodeCount} nodes / ${validatorsPerNode} vc / 1 validator > until ${event}, altairForkEpoch ${altairForkEpoch}`, async function () {
    this.timeout("10 min");

    console.log(
      "OS CPUs",
      os.cpus().map((cpu) => cpu.model)
    );

    const workers: Worker[] = [];
    const p2pPorts: number[] = [];
    const peerIdPrivkeys: string[] = [];
    const nodes: NodeWorkerOptions["nodes"] = [];
    // delay a bit so regular sync sees it's up to date and sync is completed from the beginning
    // When running multi-thread each thread has to compile the entire codebase from Typescript
    // so it takes a long time before each node is started
    const genesisSlotsDelay = 30;
    const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * testParams.SECONDS_PER_SLOT;

    for (let i = 0; i < nodeCount; i++) {
      const p2pPort = 10000 + i;
      const peerId = await createPeerId();
      const peerIdPrivkey = toHexString(peerId.marshalPrivKey());
      p2pPorts.push(p2pPort);
      peerIdPrivkeys.push(peerIdPrivkey);
      nodes.push({localMultiaddrs: [`/ip4/127.0.0.1/tcp/${p2pPort}`], peerIdPrivkey});
    }

    for (let i = 0; i < nodeCount; i++) {
      const p2pPort = p2pPorts[i];
      const peerIdPrivkey = peerIdPrivkeys[i];
      const options: NodeWorkerOptions = {
        params: {...testParams, ALTAIR_FORK_EPOCH: altairForkEpoch},
        options: {
          // Don't spawn workers from worker threads
          chain: {blsVerifyAllMainThread: true},
          network: {
            discv5: {bindAddr: `/ip4/127.0.0.1/udp/${p2pPort}`},
            localMultiaddrs: [`/ip4/127.0.0.1/tcp/${p2pPort}`],
          },
        },
        validatorCount: nodeCount * validatorsPerNode,
        genesisTime,
        nodeIndex: i,
        startIndex: i * validatorsPerNode,
        validatorsPerNode,
        checkpointEvent: event,
        logFile: `${logFilesDir}/multithread_multinode_altair-${altairForkEpoch}.log`,
        peerIdPrivkey,
        nodes,
      };

      workers.push(
        new Worker(path.join(__dirname, "threaded", "worker.js"), {
          workerData: {
            path: "./noEth1SimWorker.ts",
            options,
          },
        })
      );
    }

    interface IJustifiedCheckpointEvent {
      event: typeof event;
      checkpoint: phase0.Checkpoint;
    }
    // Wait for finalized checkpoint on all nodes
    try {
      await Promise.all(
        workers.map((worker, i) =>
          waitForEvent<IJustifiedCheckpointEvent>(worker, "message", 240000, (evt) => {
            if (evt.event === event) {
              const {epoch, root} = evt.checkpoint;
              console.log(`BeaconNode #${i} justifiedCheckpoint`, {epoch, root});
              return true;
            } else {
              return false;
            }
          })
        )
      );
      console.log("Success: Terminating workers");
    } catch (e) {
      console.log("Failure: Terminating workers. Error:", e);
      throw e;
    } finally {
      try {
        await Promise.all(workers.map((worker) => worker.terminate()));
      } catch (e) {
        console.log("Warn: failed to terminate workers", e);
      }
    }
  });
}
