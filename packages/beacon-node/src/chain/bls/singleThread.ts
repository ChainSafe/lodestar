import {ISignatureSet} from "@lodestar/state-transition";
import {PublicKey} from "@chainsafe/bls/types";
import bls from "@chainsafe/bls";
import {CoordType} from "@chainsafe/blst";
import {Metrics} from "../../metrics/index.js";
import {IBlsVerifier} from "./interface.js";
import {verifySignatureSetsMaybeBatch} from "./maybeBatch.js";
import {getAggregatedPubkey, getAggregatedPubkeysCount} from "./utils.js";

export class BlsSingleThreadVerifier implements IBlsVerifier {
  private readonly metrics: Metrics | null;

  constructor({metrics = null}: {metrics: Metrics | null}) {
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

  async verifySignatureSetsSameMessage(
    sets: {publicKey: PublicKey; signature: Uint8Array}[],
    message: Uint8Array
  ): Promise<boolean[]> {
    const startNs = process.hrtime.bigint();
    const pubkey = bls.PublicKey.aggregate(sets.map((set) => set.publicKey));
    // validate signature = true
    const signatures = sets.map((set) => bls.Signature.fromBytes(set.signature, CoordType.affine, true));
    const signature = bls.Signature.aggregate(signatures);
    const isAllValid = signature.verify(pubkey, message);

    let result: boolean[];
    if (isAllValid) {
      result = sets.map(() => true);
    } else {
      result = sets.map((set, i) => signatures[i].verify(set.publicKey, message));
    }

    const endNs = process.hrtime.bigint();
    const totalSec = Number(startNs - endNs) / 1e9;
    this.metrics?.blsThreadPool.mainThreadDurationInThreadPool.observe(totalSec);

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
