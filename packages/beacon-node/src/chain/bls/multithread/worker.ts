/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import worker from "node:worker_threads";
import {expose} from "@chainsafe/threads/worker";
import {WorkerData, BlsWorkReq, BlsWorkResult} from "./types.js";
import {verifyManySignatureSets} from "./verifyManySignatureSets.js";

// Cloned data from instatiation
const workerData = worker.workerData as WorkerData;
if (!workerData) throw Error("workerData must be defined");
const {workerId} = workerData || {};

expose({
  async verifyManySignatureSets(workReqArr: BlsWorkReq[]): Promise<BlsWorkResult> {
    return verifyManySignatureSets(workerId, workReqArr);
  },
});
