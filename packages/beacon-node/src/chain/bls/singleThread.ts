import {PublicKey, Signature} from "@chainsafe/bls/types";
import bls from "@chainsafe/bls";
import {CoordType} from "@chainsafe/blst";
import {ISignatureSet} from "@lodestar/state-transition";
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
    const timer = this.metrics?.blsThreadPool.mainThreadDurationInThreadPool.startTimer();
    const isValid = verifySignatureSetsMaybeBatch(setsAggregated);

    // Don't use a try/catch, only count run without exceptions
    if (timer) {
      timer();
    }

    return isValid;
  }

  async verifySignatureSetsSameMessage(
    sets: {publicKey: PublicKey; signature: Uint8Array}[],
    message: Uint8Array
  ): Promise<boolean[]> {
    const timer = this.metrics?.blsThreadPool.mainThreadDurationInThreadPool.startTimer();
    const pubkey = bls.PublicKey.aggregate(sets.map((set) => set.publicKey));
    let isAllValid = true;
    // validate signature = true
    const signatures = sets.map((set) => {
      try {
        return bls.Signature.fromBytes(set.signature, CoordType.affine, true);
      } catch (_) {
        // at least one set has malformed signature
        isAllValid = false;
        return null;
      }
    });

    if (isAllValid) {
      const signature = bls.Signature.aggregate(signatures as Signature[]);
      isAllValid = signature.verify(pubkey, message);
    }

    let result: boolean[];
    if (isAllValid) {
      result = sets.map(() => true);
    } else {
      result = sets.map((set, i) => {
        const sig = signatures[i];
        if (sig === null) {
          return false;
        }
        return sig.verify(set.publicKey, message);
      });
    }

    if (timer) {
      timer();
    }

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
