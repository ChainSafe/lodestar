export type WorkerData = {
  implementation: "herumi" | "blst-native";
  workerId: number;
};

export type BlsWorkReq = {
  validateSignature: boolean;
  sets: {publicKey: Uint8Array; message: Uint8Array; signature: Uint8Array}[];
};

export type BlsWorkResult = WorkResult<boolean>;

export enum WorkResultCode {
  success = "success",
  error = "error",
}

export type WorkResult<R> =
  | {code: WorkResultCode.success; result: R; workerJobTimeMs: number; workerId: number}
  | {code: WorkResultCode.error; error: Error};

export enum WorkerMessageCode {
  workRequest = "workRequest",
  workAcknowledge = "workAcknowledge",
  workResult = "blsWorkResult",
  ready = "ready",
}

export type WorkerMessage =
  | {code: WorkerMessageCode.workRequest; taskId: number; requests: BlsWorkReq[]}
  | {code: WorkerMessageCode.workAcknowledge; taskId: number}
  | {code: WorkerMessageCode.workResult; taskId: number; results: WorkResult<unknown>[]}
  | {code: WorkerMessageCode.ready};

// export type WorkerApi = {
//   verify(impl: Implementation, publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean>;
//   verifyMultipleAggregateSignatures(
//     impl: Implementation,
//     sets: {publicKey: Uint8Array; message: Uint8Array; signature: Uint8Array}[]
//   ): Promise<boolean>;
// };
