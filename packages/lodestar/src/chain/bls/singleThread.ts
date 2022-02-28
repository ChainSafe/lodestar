import {ISignatureSet} from "@chainsafe/lodestar-beacon-state-transition";
import {IMetrics} from "../../metrics";
import {IBlsVerifier} from "./interface";
import {verifySignatureSetsMaybeBatch} from "./maybeBatch";
import {getAggregatedPubkey} from "./utils";

export class BlsSingleThreadVerifier implements IBlsVerifier {
  private readonly metrics: IMetrics | null;

  constructor({metrics = null}: {metrics: IMetrics | null}) {
    this.metrics = metrics;
  }

  async verifySignatureSets(sets: ISignatureSet[]): Promise<boolean> {
    const startNs = process.hrtime.bigint();
    const isValid = verifySignatureSetsMaybeBatch(
      sets.map((set) => ({
        publicKey: getAggregatedPubkey(set),
        message: set.signingRoot.valueOf() as Uint8Array,
        signature: set.signature,
      }))
    );

    const endNs = process.hrtime.bigint();
    this.metrics?.blsTime.singleThreadDuration.observe(Number(endNs - startNs) / 1e9);

    return isValid;
  }
}
