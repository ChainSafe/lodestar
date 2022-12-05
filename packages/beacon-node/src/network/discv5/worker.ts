import worker from "worker_threads";
import {expose} from "@chainsafe/threads/worker";
import { Observable, Subject } from "@chainsafe/threads/observable";
import {WorkerData} from "./types.js";

// Cloned data from instatiation
const workerData = worker.workerData as WorkerData;
if (!workerData) throw Error("workerData must be defined");

/** Used to push discovered ENRs */
const subject = new Subject();

expose({
  async enr(): Promise<string> {

  },
  discovered() {
    return Observable.from(subject);
  },
})
