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

    const setsAggregated = sets.map((set) => ({
      publicKey: getAggregatedPubkey(set),
      message: set.signingRoot,
      signature: set.signature,
    }));

    // Count time after aggregating
    const startNs = process.hrtime.bigint();

    const isValid = verifySignatureSetsMaybeBatch(setsAggregated);

    // Don't use a try/catch, only count run without exceptions
    const endNs = process.hrtime.bigint();
    const totalSec = Number(startNs - endNs) / 1e9;
    this.metrics?.blsThreadPool.mainThreadDurationInThreadPool.observe(totalSec);
    this.metrics?.blsThreadPool.mainThreadDurationInThreadPool.observe(totalSec / sets.length);

    return isValid;
  }

  async close(): Promise<void> {
    // nothing to do
  }
}
