import {
  SignatureSet,
  CoordType,
  PublicKey,
  Signature,
  aggregatePublicKeys,
  aggregateSignatures,
  verify,
} from "@chainsafe/blst-ts";
import {ISignatureSet} from "@lodestar/state-transition";
import {Metrics} from "../../metrics/index.js";
import {IBlsVerifier} from "./interface.js";
import {verifySignatureSets} from "./verifySignatureSets.js";
import {getAggregatedPubkey} from "./utils.js";

export class BlsSingleThreadVerifier implements IBlsVerifier {
  private readonly metrics: Metrics | null;

  constructor({metrics = null}: {metrics: Metrics | null}) {
    this.metrics = metrics;
  }

  async verifySignatureSets(sets: ISignatureSet[]): Promise<boolean> {
    const setsAggregated: SignatureSet[] = sets.map((set) => ({
      publicKey: getAggregatedPubkey(this.metrics, set),
      message: set.signingRoot,
      signature: set.signature,
    }));

    // Count time after aggregating
    const timer = this.metrics?.bls.mainThread.verificationDuration.startTimer();
    const isValid = verifySignatureSets(setsAggregated);

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
    const timer = this.metrics?.bls.mainThread.verificationDuration.startTimer();
    const pubkey = aggregatePublicKeys(sets.map((set) => set.publicKey));
    let isAllValid = true;
    // validate signature = true
    const signatures = sets.map((set) => {
      try {
        return Signature.deserialize(set.signature, CoordType.affine);
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
        return verify(message, set.publicKey, sig);
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
