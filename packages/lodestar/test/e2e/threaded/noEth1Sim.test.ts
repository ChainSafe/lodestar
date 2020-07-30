import {Worker} from "worker_threads";
import {expect} from "chai";
import {IBeaconParams} from "@chainsafe/lodestar-params";
import {Checkpoint} from "@chainsafe/lodestar-types";
import {waitForEvent} from "../../utils/events/resolver";

describe("no eth1 sim (multi-node test)", function () {

  const validatorsPerNode = 8;
  const beaconParams: Partial<IBeaconParams> = {
    SECONDS_PER_SLOT: 2,
    SLOTS_PER_EPOCH: 8
  };

  for (const nodeCount of [4]) {
    it(`Run ${nodeCount} nodes, ${validatorsPerNode} validators each until justified`, async function () {
      this.timeout("10 min");

      const workers = [];
      const genesisTime = Math.floor(Date.now() / 1000);

      for (let i=0; i<nodeCount; i++) {
        const options = {
          params: beaconParams,
          options: {sync: {minPeers: 0}},
          validatorCount: nodeCount * validatorsPerNode,
          genesisTime,
          nodeIndex: i,
          startIndex: i * validatorsPerNode,
          validatorsPerNode,
        };

        const worker = new Worker(__dirname + "/worker.js", {
          workerData: {
            path: "./noEth1SimWorker.ts",
            options,
          }
        });

        workers.push(worker);
      }

      interface IJustifiedCheckpointEvent {
        event: "justifiedCheckpoint";
        checkpoint: Checkpoint;
      }
      // Wait for finalized checkpoint on all nodes
      try {
        const checkpoints = await Promise.all(workers.map(worker =>
          waitForEvent<IJustifiedCheckpointEvent>(worker, "message", 240000, (evt) => {
            return evt.event == "justifiedCheckpoint";
          })
        ));
        console.log("Success: Terminating workers", checkpoints);
        await Promise.all(workers.map(worker => worker.terminate()));
      } catch (e) {
        console.log("Failure: Terminating workers");
        await Promise.all(workers.map(worker => worker.terminate()));
        expect.fail(e);
      }
    });
  }
});

