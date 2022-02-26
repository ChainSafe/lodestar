import {ISignatureSet} from "@chainsafe/lodestar-beacon-state-transition";
import {IBlsVerifier, VerifySignatureOpts} from "./interface";
import {BlsMultiThreadWorkerPool, BlsMultiThreadWorkerPoolModules} from "./multithread";
import {BlsSingleThreadVerifier} from "./singleThread";

/**
 * This sends batchable jobs to worker threads and non batchable jobs to main thread.
 * This helps the BLS thread pool - job wait time to be consistently < 100ms.
 * See https://github.com/ChainSafe/lodestar/issues/3792
 */
export class BlsMixedVerifier implements IBlsVerifier {
  private singleThreadBls: IBlsVerifier;
  private multiThreadBls: IBlsVerifier;

  constructor(modules: BlsMultiThreadWorkerPoolModules) {
    this.singleThreadBls = new BlsSingleThreadVerifier();
    this.multiThreadBls = new BlsMultiThreadWorkerPool(modules);
  }

  async verifySignatureSets(sets: ISignatureSet[], opts: VerifySignatureOpts = {}): Promise<boolean> {
    if (opts.batchable) {
      return this.multiThreadBls.verifySignatureSets(sets, opts);
    } else {
      return this.singleThreadBls.verifySignatureSets(sets);
    }
  }
}
