import {BLSPubkey} from "@chainsafe/lodestar-types";
import {IMinMaxSurround, IDistanceEntry, IDistanceStore, MinMaxSurroundAttestation} from "./interface.js";
import {SurroundAttestationError, SurroundAttestationErrorCode} from "./errors.js";

// surround vote checking with min-max surround
// https://github.com/protolambda/eth2-surround#min-max-surround

export class MinMaxSurround implements IMinMaxSurround {
  private store: IDistanceStore;
  private maxEpochLookback: number;

  constructor(store: IDistanceStore, options?: {maxEpochLookback?: number}) {
    this.store = store;
    this.maxEpochLookback = options?.maxEpochLookback ?? Infinity;
  }

  async assertNoSurround(pubKey: BLSPubkey, attestation: MinMaxSurroundAttestation): Promise<void> {
    await this.assertNotSurrounding(pubKey, attestation);
    await this.assertNotSurrounded(pubKey, attestation);
  }

  async insertAttestation(pubKey: BLSPubkey, attestation: MinMaxSurroundAttestation): Promise<void> {
    await this.updateMinSpan(pubKey, attestation);
    await this.updateMaxSpan(pubKey, attestation);
  }

  // min span

  private async updateMinSpan(pubKey: BLSPubkey, attestation: MinMaxSurroundAttestation): Promise<void> {
    await this.assertNotSurrounding(pubKey, attestation);

    const untilEpoch = Math.max(0, attestation.sourceEpoch - 1 - this.maxEpochLookback);

    const values: IDistanceEntry[] = [];
    for (let epoch = attestation.sourceEpoch - 1; epoch >= untilEpoch; epoch--) {
      const minSpan = await this.store.minSpan.get(pubKey, epoch);
      const distance = attestation.targetEpoch - epoch;
      if (minSpan === null || distance < minSpan) {
        values.push({source: epoch, distance});
      } else {
        break;
      }
    }
    await this.store.minSpan.setBatch(pubKey, values);
  }

  private async assertNotSurrounding(pubKey: BLSPubkey, attestation: MinMaxSurroundAttestation): Promise<void> {
    const minSpan = await this.store.minSpan.get(pubKey, attestation.sourceEpoch);
    const distance = attestation.targetEpoch - attestation.sourceEpoch;
    if (minSpan != null && minSpan > 0 && minSpan < distance) {
      throw new SurroundAttestationError({
        code: SurroundAttestationErrorCode.IS_SURROUNDING,
        attestation,
        attestation2Target: attestation.sourceEpoch + minSpan,
      });
    }
  }

  // max span

  private async updateMaxSpan(pubKey: BLSPubkey, attestation: MinMaxSurroundAttestation): Promise<void> {
    await this.assertNotSurrounded(pubKey, attestation);

    const values: IDistanceEntry[] = [];
    for (let epoch = attestation.sourceEpoch + 1; epoch < attestation.targetEpoch; epoch++) {
      const maxSpan = await this.store.maxSpan.get(pubKey, epoch);
      const distance = attestation.targetEpoch - epoch;
      if (maxSpan === null || distance > maxSpan) {
        values.push({source: epoch, distance});
      } else {
        break;
      }
    }
    await this.store.maxSpan.setBatch(pubKey, values);
  }

  private async assertNotSurrounded(pubKey: BLSPubkey, attestation: MinMaxSurroundAttestation): Promise<void> {
    const maxSpan = await this.store.maxSpan.get(pubKey, attestation.sourceEpoch);
    const distance = attestation.targetEpoch - attestation.sourceEpoch;
    if (maxSpan != null && maxSpan > 0 && maxSpan > distance) {
      throw new SurroundAttestationError({
        code: SurroundAttestationErrorCode.IS_SURROUNDED,
        attestation: attestation,
        attestation2Target: attestation.sourceEpoch + maxSpan,
      });
    }
  }
}
