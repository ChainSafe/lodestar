import {spawn, Pool, Worker} from "threads";
// `threads` library creates self global variable which breaks `timeout-abort-controller` https://github.com/jacobheun/timeout-abort-controller/issues/9
// @ts-ignore
// eslint-disable-next-line
self = undefined;
import {Implementation, PointFormat, PublicKey} from "@chainsafe/bls";
import {ILogger} from "@chainsafe/lodestar-utils";
import {BlsWorkReq, WorkerData, WorkResult, WorkResultCode} from "./types";
import {chunkify} from "./utils";

type WorkerApi = {
  doManyBlsWorkReq(workReqArr: BlsWorkReq[]): Promise<WorkResult<boolean>[]>;
};

/**
 * Wraps "threads" library thread pool queue system with the goals:
 * - Complete total outstanding jobs in total minimum time possible.
 *   Will split large signature sets into smaller sets and send to different workers
 * - Reduce the latency cost for small signature sets. In NodeJS 12,14 worker <-> main thread
 *   communiction has very high latency, of around ~5 ms. So package multiple small signature
 *   sets into packages of work and send at once to a worker to distribute the latency cost
 */
export class BlsMultiThreadNaive {
  private readonly logger: ILogger;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly pool: Pool<any>;
  private readonly format: PointFormat;

  constructor(logger: ILogger, implementation: Implementation) {
    this.logger = logger;

    // Use compressed for herumi for now.
    // THe worker is not able to deserialize from uncompressed
    // `Error: err _wrapDeserialize`
    this.format = implementation === "blst-native" ? PointFormat.uncompressed : PointFormat.compressed;

    const workerData: WorkerData = {implementation};
    this.pool = Pool(() =>
      spawn(new Worker("./worker", {workerData} as ConstructorParameters<typeof Worker>[1]), {
        // A Lodestar Node may do very expensive task at start blocking the event loop and causing
        // the initialization to timeout. The number below is big enough to almost disable the timeout
        timeout: 5 * 60 * 1000,
      })
    );
  }

  async destroy(): Promise<void> {
    // Stop all JavaScript execution in the worker thread as soon as possible.
    // Returns a Promise for the exit code that is fulfilled when the 'exit' event is emitted.
    await this.pool.terminate(true);
  }

  async verify(
    publicKey: PublicKey,
    message: Uint8Array,
    signature: Uint8Array,
    validateSignature: boolean
  ): Promise<boolean> {
    return await this.queueBlsWork({
      validateSignature,
      sets: [{publicKey: publicKey.toBytes(this.format), message, signature: signature}],
    });
  }

  async verifyMultipleAggregateSignatures(
    sets: {publicKey: PublicKey; message: Uint8Array; signature: Uint8Array}[],
    validateSignature: boolean
  ): Promise<boolean> {
    const results = await Promise.all(
      chunkify(sets, 32).map((setsWorker) =>
        this.queueBlsWork({
          validateSignature,
          sets: setsWorker.map((s) => ({
            publicKey: s.publicKey.toBytes(this.format),
            message: s.message,
            signature: s.signature,
          })),
        })
      )
    );

    return results.every((isValid) => isValid === true);
  }

  private async queueBlsWork(workReq: BlsWorkReq): Promise<boolean> {
    const results = await this.pool.queue(async (task: WorkerApi) => {
      return task.doManyBlsWorkReq([workReq]);
    });

    const result = results[0];
    if (result.code === WorkResultCode.success) {
      return result.result;
    } else {
      throw Error(result.error.message);
    }
  }
}
