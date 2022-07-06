import {ISignatureSet} from "@lodestar/state-transition";
import {IMetrics} from "../../metrics/index.js";
import {IBlsVerifier} from "./interface.js";
import {verifySignatureSetsMaybeBatch} from "./maybeBatch.js";
import {getAggregatedPubkey, getAggregatedPubkeysCount} from "./utils.js";

export class BlsSingleThreadVerifier implements IBlsVerifier {
  private readonly metrics: IMetrics | null;

  constructor({metrics = null}: {metrics: IMetrics | null}) {
    this.metrics = metrics;
  }

  async verifySignatureSets(sets: ISignatureSet[]): Promise<boolean> {
    this.metrics?.bls.aggregatedPubkeys.inc(getAggregatedPubkeysCount(sets));
    const timer = this.metrics?.blsThreadPool.mainThreadDurationInThreadPool.startTimer();

    try {
      return verifySignatureSetsMaybeBatch(
        sets.map((set) => ({
          publicKey: getAggregatedPubkey(set),
          message: set.signingRoot,
          signature: set.signature,
        }))
      );
    } finally {
      if (timer) timer();
    }
  }

  async close(): Promise<void> {
    // nothing to do
  }
}
