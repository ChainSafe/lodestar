/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import worker from "node:worker_threads";
import {expose} from "@chainsafe/threads/worker";
import {WorkerData, BlsWorkReq, BlsWorkResult} from "./types.js";
import {runWorkRequests} from "./runWorkRequests.js";

// Cloned data from instatiation
const workerData = worker.workerData as WorkerData;
if (!workerData) throw Error("workerData must be defined");
const {workerId} = workerData || {};

expose({
  async runWorkRequests(workReqArr: BlsWorkReq[]): Promise<BlsWorkResult> {
    return runWorkRequests(workerId, workReqArr);
  },
});
