import {verifySignatureSetsSameMessage as verifySignatureSetsSameMessageNative} from "@chainsafe/lodestar-z/bls-verifier";
import {ISignatureSet} from "@lodestar/state-transition";
import {Metrics} from "../../metrics/index.js";
import {IBlsVerifier, SameMessageSignatureSet} from "./interface.js";
import {chunkSameMessageSignatureSets, getAggregatedPubkeysCount, verifySignatureSetsInNativeBatches} from "./utils.js";

export class BlsSingleThreadVerifier implements IBlsVerifier {
  private readonly metrics: Metrics | null;
  constructor({metrics = null}: {metrics: Metrics | null}) {
    this.metrics = metrics;
  }

  async verifySignatureSets(sets: ISignatureSet[]): Promise<boolean> {
    this.metrics?.bls.aggregatedPubkeys.inc(getAggregatedPubkeysCount(sets));

    const timer = this.metrics?.blsThreadPool.mainThreadDurationInThreadPool.startTimer();
    const isValid = verifySignatureSetsInNativeBatches(sets);

    // Don't use a try/catch, only count run without exceptions
    if (timer) {
      timer();
    }

    return isValid;
  }

  async verifySignatureSetsSameMessage(sets: SameMessageSignatureSet[], message: Uint8Array): Promise<boolean[]> {
    const timer = this.metrics?.blsThreadPool.mainThreadDurationInThreadPool.startTimer();
    const result: boolean[] = [];
    for (const setsChunk of chunkSameMessageSignatureSets(sets)) {
      result.push(...verifySignatureSetsSameMessageNative(setsChunk, message));
    }
    timer?.();
    return result;
  }

  async close(): Promise<void> {
    // nothing to do
  }

  canAcceptWork(): boolean {
    // Since sigs are verified blocking the main thread, there's no mechanism to throttle
    return true;
  }
}
