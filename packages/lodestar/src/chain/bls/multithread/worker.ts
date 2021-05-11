import worker from "worker_threads";
import {expose} from "threads/worker";
import {bls, init, CoordType} from "@chainsafe/bls";
import {WorkerData, BlsWorkReq, WorkResult, WorkResultCode} from "./types";

const MIN_SET_COUNT_TO_BATCH = 2;

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
      const isValid = verifySignatureSetsMaybeBatch(workReq);
      const workerJobTimeMs = Date.now() - start;
      return {code: WorkResultCode.success, result: isValid, workerJobTimeMs, workerId};
    } catch (e) {
      return {code: WorkResultCode.error, error: e as Error};
    }
  });
}

function verifySignatureSetsMaybeBatch(workReq: BlsWorkReq): boolean {
  if (workReq.sets.length >= MIN_SET_COUNT_TO_BATCH) {
    return bls.Signature.verifyMultipleSignatures(
      workReq.sets.map((s) => ({
        publicKey: bls.PublicKey.fromBytes(s.publicKey, CoordType.affine),
        message: s.message,
        signature: bls.Signature.fromBytes(s.signature, CoordType.affine, workReq.validateSignature),
      }))
    );
  }

  // .every on an empty array returns true
  if (workReq.sets.length === 0) {
    throw Error("Empty signature set");
  }

  // If too few signature sets verify them without batching
  return workReq.sets.every((set) => {
    const pk = bls.PublicKey.fromBytes(set.publicKey, CoordType.affine);
    const sig = bls.Signature.fromBytes(set.signature, CoordType.affine, workReq.validateSignature);
    return sig.verify(pk, set.message);
  });
}
