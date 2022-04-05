import {ISignatureSet} from "@chainsafe/lodestar-beacon-state-transition";
import {IBlsVerifier} from "./interface";
import {verifySignatureSetsMaybeBatch} from "./maybeBatch";
import {getAggregatedPubkey} from "./utils";
import {IMetrics} from "../../metrics";

export class BlsSingleThreadVerifier implements IBlsVerifier {
  private readonly metrics: IMetrics | null;

  constructor({metrics = null}: {metrics: IMetrics | null}) {
    this.metrics = metrics;
  }

  async verifySignatureSets(sets: ISignatureSet[]): Promise<boolean> {
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
}
