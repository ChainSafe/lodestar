import worker from "worker_threads";
import {expose} from "threads/worker";
import {bls, init, CoordType} from "@chainsafe/bls";
import {WorkerData, BlsWorkCode, BlsWorkReq, WorkResult, WorkResultCode} from "./types";

/* eslint-disable no-console */

// Unique integer identifying the worker
worker.threadId;
// Cloned data from instatiation
const workerData = worker.workerData as WorkerData;
if (!workerData) throw Error("workerData must be defined");
const {implementation} = workerData || {};

expose({
  async doManyBlsWorkReq(workReqArr: BlsWorkReq[]): Promise<WorkResult<boolean>[]> {
    await init(implementation);
    return doManyBlsWorkReq(workReqArr);
  },
  async echo(hello) {
    return `${hello} world`;
  },
});

//
//

function doManyBlsWorkReq(workReqArr: BlsWorkReq[]): WorkResult<boolean>[] {
  return workReqArr.map((workReq) => {
    try {
      return {code: WorkResultCode.success, result: doBlsWorkReq(workReq)};
    } catch (e) {
      return {code: WorkResultCode.error, error: e as Error};
    }
  });
}

function doBlsWorkReq(workReq: BlsWorkReq): boolean {
  switch (workReq.code) {
    case BlsWorkCode.verify: {
      const pk = bls.PublicKey.fromBytes(workReq.publicKey, CoordType.affine);
      const sig = bls.Signature.fromBytes(workReq.signature, CoordType.affine, true);
      return sig.verify(pk, workReq.message);
    }

    case BlsWorkCode.batchVerify: {
      return bls.Signature.verifyMultipleSignatures(
        workReq.sets.map((s) => ({
          publicKey: bls.PublicKey.fromBytes(s.publicKey, CoordType.affine),
          message: s.message,
          signature: bls.Signature.fromBytes(s.signature, CoordType.affine, true),
        }))
      );
    }

    default:
      throw Error("Unknown work request code");
  }
}
