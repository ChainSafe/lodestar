import {PublicKey, Signature, aggregatePublicKeysAsync, aggregateSignaturesAsync, verifyAsync} from "@chainsafe/blst";
import {ISignatureSet} from "@lodestar/state-transition";
import {Metrics} from "../../metrics/index.js";
import {IBlsVerifier} from "./interface.js";
import {verifySignatureSetsMaybeBatchAsync} from "./maybeBatch.js";
import {getAggregatedPubkeyAsync, getAggregatedPubkeysCount} from "./utils.js";

export class BlsAsyncBlstVerifier implements IBlsVerifier {
  private readonly metrics: Metrics | null;

  constructor({metrics = null}: {metrics: Metrics | null}) {
    this.metrics = metrics;
  }

  async verifySignatureSets(sets: ISignatureSet[]): Promise<boolean> {
    this.metrics?.bls.aggregatedPubkeys.inc(getAggregatedPubkeysCount(sets));

    const setsAggregated = await Promise.all(
      sets.map(async (set) => ({
        publicKey: await getAggregatedPubkeyAsync(set),
        message: set.signingRoot,
        signature: set.signature,
      }))
    );

    // Count time after aggregating
    const timer = this.metrics?.blsThreadPool.mainThreadDurationInThreadPool.startTimer();
    const isValid = await verifySignatureSetsMaybeBatchAsync(setsAggregated);

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
    const pubkey = await aggregatePublicKeysAsync(sets.map((set) => set.publicKey));
    let isAllValid = true;
    // validate signature = true
    const signatures = sets.map((set) => {
      try {
        return Signature.fromBytes(set.signature, true);
      } catch (_) {
        // at least one set has malformed signature
        isAllValid = false;
        return null;
      }
    });

    if (isAllValid) {
      const signature = await aggregateSignaturesAsync(signatures as Signature[]);
      isAllValid = await verifyAsync(message, pubkey, signature);
    }

    let result: boolean[];
    if (isAllValid) {
      result = sets.map(() => true);
    } else {
      result = await Promise.all(
        sets.map(async (set, i) => {
          const sig = signatures[i];
          if (sig === null) {
            return false;
          }
          return verifyAsync(message, set.publicKey, sig);
        })
      );
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
