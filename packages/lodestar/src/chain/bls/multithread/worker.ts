import worker from "worker_threads";
import {expose} from "threads/worker";
import {bls, init, CoordType} from "@chainsafe/bls";
import {WorkerData, BlsWorkReq, WorkResult, WorkResultCode} from "./types";
import {verifySignatureSetsMaybeBatch} from "../maybeBatch";

/* eslint-disable no-console */

// Cloned data from instatiation
const workerData = worker.workerData as WorkerData;
if (!workerData) throw Error("workerData must be defined");
const {implementation, workerId} = workerData || {};

expose({
  async doManyBlsWorkReq(workReqArr: BlsWorkReq[]): Promise<WorkResult<boolean>[]> {
    await init(implementation);
    return doManyBlsWorkReq(workReqArr);
  },
});

function doManyBlsWorkReq(workReqArr: BlsWorkReq[]): WorkResult<boolean>[] {
  return workReqArr.map((workReq) => {
    try {
      const start = Date.now();
      const isValid = verifySignatureSetsMaybeBatch(
        workReq.sets.map((set) => ({
          publicKey: bls.PublicKey.fromBytes(set.publicKey, CoordType.affine),
          message: set.message,
          signature: set.signature,
        })),
        workReq.validateSignature
      );
      const workerJobTimeMs = Date.now() - start;
      return {code: WorkResultCode.success, result: isValid, workerJobTimeMs, workerId};
    } catch (e) {
      return {code: WorkResultCode.error, error: e as Error};
    }
  });
}
