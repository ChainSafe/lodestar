import path from "path";
import {Worker} from "worker_threads";
import {expect} from "chai";
import {IBeaconParams} from "@chainsafe/lodestar-params";
import {Checkpoint} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {waitForEvent} from "../utils/events/resolver";

describe("Run multi node multi thread interop validators (no eth1) until checkpoint", function () {
  const checkpointEvent = "justifiedCheckpoint";
  const validatorsPerNode = 8;
  const beaconParams: Partial<IBeaconParams> = {
    SECONDS_PER_SLOT: 2,
    SLOTS_PER_EPOCH: 8
  };

  for (const nodeCount of [4]) {
    it(`${nodeCount} nodes / ${validatorsPerNode} vc / 1 validator > until ${checkpointEvent}`, async function () {
      this.timeout("10 min");

      const workers = [];
      const genesisTime = Math.floor(Date.now() / 1000);

      for (let i=0; i<nodeCount; i++) {
        const options = {
          params: beaconParams,
          options: {sync: {minPeers: 1}},
          validatorCount: nodeCount * validatorsPerNode,
          genesisTime,
          nodeIndex: i,
          startIndex: i * validatorsPerNode,
          validatorsPerNode,
          checkpointEvent
        };

        const worker = new Worker(path.join(__dirname, "threaded", "worker.js"), {
          workerData: {
            path: "./noEth1SimWorker.ts",
            options,
          }
        });

        workers.push(worker);
      }

      interface IJustifiedCheckpointEvent {
        event: typeof checkpointEvent;
        checkpoint: Checkpoint;
      }
      // Wait for finalized checkpoint on all nodes
      try {
        await Promise.all(workers.map((worker, i) =>
          waitForEvent<IJustifiedCheckpointEvent>(worker, "message", 240000, (evt) => {
            if (evt.event === checkpointEvent) {
              const epoch = evt.checkpoint.epoch;
              const rootHex = toHexString(evt.checkpoint.root);
              console.log(`BeaconNode #${i} justifiedCheckpoint`, {epoch, rootHex});
              return true;
            } else {
              return false;
            }
          })
        ));
        console.log("Success: Terminating workers");
        await Promise.all(workers.map(worker => worker.terminate()));
      } catch (e) {
        console.log("Failure: Terminating workers");
        await Promise.all(workers.map(worker => worker.terminate()));
        expect.fail(e);
      }
    });
  }
});
