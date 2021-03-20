import path from "path";
import os from "os";
import {Worker} from "worker_threads";
import {IBeaconParams} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {waitForEvent} from "../utils/events/resolver";
import {ChainEvent} from "../../src/chain";
import {createPeerId} from "../../src/network";
import {logFiles} from "./params";
import {NodeWorkerOptions} from "./threaded/types";

/* eslint-disable no-console */

describe("Run multi node multi thread interop validators (no eth1) until checkpoint", function () {
  const checkpointEvent = ChainEvent.justified;
  const validatorsPerNode = 8;
  const beaconParams: Pick<IBeaconParams, "SECONDS_PER_SLOT" | "SLOTS_PER_EPOCH"> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SECONDS_PER_SLOT: 2,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SLOTS_PER_EPOCH: 8,
  };

  for (const nodeCount of [4]) {
    it(`${nodeCount} nodes / ${validatorsPerNode} vc / 1 validator > until ${checkpointEvent}`, async function () {
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
      const minGenesisTime = Math.floor(Date.now() / 1000);
      // it takes more time to detect peers in threaded test
      const genesisDelay = 30 * beaconParams.SECONDS_PER_SLOT;
      const genesisTime = minGenesisTime + genesisDelay;

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
          params: beaconParams,
          options: {
            sync: {minPeers: 1},
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
          checkpointEvent,
          logFile: logFiles.multinodeMultithread,
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
        event: typeof checkpointEvent;
        checkpoint: phase0.Checkpoint;
      }
      // Wait for finalized checkpoint on all nodes
      try {
        await Promise.all(
          workers.map((worker, i) =>
            waitForEvent<IJustifiedCheckpointEvent>(worker, "message", 240000, (evt) => {
              if (evt.event === checkpointEvent) {
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
        await Promise.all(workers.map((worker) => worker.terminate()));
      } catch (e) {
        console.log("Failure: Terminating workers. Error:", e);
        await Promise.all(workers.map((worker) => worker.terminate()));
        throw e;
      }
    });
  }
});
