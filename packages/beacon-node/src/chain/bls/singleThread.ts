import {AggregationSet, PublicKey, Signature, aggregatePublicKeys, aggregateSignatures, verify} from "@chainsafe/blst";
import {ISignatureSet} from "@lodestar/state-transition";
import {signatureFromBytes} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {IBlsVerifier} from "./interface.js";
import {verifySets} from "./verifySets.js";
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
    const isValid = verifySets(setsAggregated);

    // Don't use a try/catch, only count run without exceptions
    if (timer) {
      timer();
    }

    return isValid;
  }

  async verifySignatureSetsSameMessage(
    sets: AggregationSet[],
    message: Uint8Array
  ): Promise<boolean[]> {
    const timer = this.metrics?.blsThreadPool.mainThreadDurationInThreadPool.startTimer();
    const pubkey = aggregatePublicKeys(sets.map((set) => set.pk));
    let isAllValid = true;
    // validate signature = true
    const signatures = sets.map((set) => {
      try {
        return signatureFromBytes(set.sig);
      } catch (_) {
        // at least one set has malformed signature
        isAllValid = false;
        return null;
      }
    });

    if (isAllValid) {
      const signature = aggregateSignatures(signatures as Signature[]);
      isAllValid = verify(message, pubkey, signature);
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
        return verify(message, set.pk, sig);
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
