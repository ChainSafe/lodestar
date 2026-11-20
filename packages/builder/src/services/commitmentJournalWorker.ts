import {parentPort, workerData} from "node:worker_threads";
import type {JournalReply, JournalRequest, JournalWorkerData} from "./asyncCommitmentJournal.js";
import {CommitmentJournal, type DurablePayload} from "./commitmentJournal.js";
import type {JournalExposure} from "./orderExposure.js";

const port = parentPort;
if (!port) throw Error("COMMITMENT_WORKER_PORT");
const {directory, identity, sharedPayloadDirectory} = workerData as JournalWorkerData;
const journal = new CommitmentJournal(directory, identity, undefined, sharedPayloadDirectory);
port.on("message", ({id, operation}: JournalRequest) => {
  let error: string | undefined;
  let reference: DurablePayload | undefined;
  let exposure: JournalExposure | undefined;
  try {
    switch (operation.kind) {
      case "retain":
        reference = journal.retain(operation.bid, operation.stored);
        break;
      case "retainReference":
        journal.retainReference(operation.bid, operation.reference);
        break;
      case "reveal":
        journal.retainReveal(operation.record);
        break;
      case "exposure":
        exposure = journal.queryExposure(operation.orderId, operation.admittedAtUnixMs);
        break;
      case "prune":
        journal.prune(operation.slot);
        break;
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  port.postMessage({
    id,
    error,
    reference,
    exposure,
    coverageLost: !journal.hasExposureCoverage(),
  } satisfies JournalReply);
});
port.postMessage({id: 0, coverageLost: !journal.hasExposureCoverage()} satisfies JournalReply);
