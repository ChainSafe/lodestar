import path from "path";
import os from "os";
import {Worker} from "worker_threads";
import {IBeaconParams} from "@chainsafe/lodestar-params";
import {Checkpoint} from "@chainsafe/lodestar-types";

describe("Run multi node multi thread interop validators (no eth1) until checkpoint", function () {
  const checkpointEvent = "justified";
  const maxEpoch = 10;
  const validatorsPerNode = 8;
  const beaconParams: Pick<IBeaconParams, "SECONDS_PER_SLOT" | "SLOTS_PER_EPOCH"> = {
    SECONDS_PER_SLOT: 2,
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
      // delay a bit so regular sync sees it's up to date and sync is completed from the beginning
      const minGenesisTime = Math.floor(Date.now() / 1000);
      // it takes more time to detect peers in threaded test
      const genesisDelay = 20 * beaconParams.SECONDS_PER_SLOT;
      const genesisTime = minGenesisTime + genesisDelay;

      for (let i = 0; i < nodeCount; i++) {
        const options = {
          params: beaconParams,
          options: {sync: {minPeers: 1}},
          validatorCount: nodeCount * validatorsPerNode,
          genesisTime,
          nodeIndex: i,
          startIndex: i * validatorsPerNode,
          validatorsPerNode,
          checkpointEvent,
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
        checkpoint: Checkpoint;
      }
      // Wait for finalized checkpoint on all nodes
      try {
        await Promise.all(
          workers.map(
            (worker, i) =>
              new Promise((resolve, reject) => {
                worker.on("message", (evt) => {
                  switch (evt.event) {
                    case checkpointEvent:
                      console.log(`BeaconNode #${i} justifiedCheckpoint`, evt.checkpoint);
                      return resolve();

                    case "clock:epoch":
                      if (evt.epoch > maxEpoch) {
                        return reject(Error(`Event ${checkpointEvent} not reached before max epoch ${maxEpoch}`));
                      }
                  }
                });
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
