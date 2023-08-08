import {ISignatureSet} from "@lodestar/state-transition";
import {Metrics} from "../../metrics/index.js";
import {IBlsVerifier} from "./interface.js";
import {verifySignatureSetsMaybeBatch} from "./maybeBatch.js";
import {getAggregatedPubkey, getAggregatedPubkeysCount} from "./utils.js";
import {SerializedSignatureSet} from "./multithread/types.js";

export class BlsSingleThreadVerifier implements IBlsVerifier {
  private readonly metrics: Metrics | null;

  constructor({metrics = null}: {metrics: Metrics | null}) {
    this.metrics = metrics;
  }

  async verifySignatureSets(sets: ISignatureSet[]): Promise<boolean> {
    this.metrics?.bls.aggregatedPubkeys.inc(getAggregatedPubkeysCount(sets));

    const setsAggregated: SerializedSignatureSet[] = sets.map((set) => ({
      publicKey: getAggregatedPubkey(set).serialize(false),
      message: set.signingRoot,
      signature: set.signature,
    }));

    // Count time after aggregating
    const startNs = process.hrtime.bigint();

    const isValid = verifySignatureSetsMaybeBatch(setsAggregated);

    // Don't use a try/catch, only count run without exceptions
    const endNs = process.hrtime.bigint();
    const totalSec = Number(startNs - endNs) / 1e9;
    this.metrics?.bls.mainThread.durationOnThread.observe(totalSec);
    this.metrics?.bls.mainThread.durationOnThread.observe(totalSec / sets.length);

    return isValid;
  }

  async close(): Promise<void> {
    // nothing to do
  }

  canAcceptWork(): boolean {
    // Since sigs are verified blocking the main thread, there's no mechanism to throttle
    return true;
  }
}
