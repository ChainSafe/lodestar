import {BLSPubkey} from "@lodestar/types";
import {IMinMaxSurround, DistanceEntry, IDistanceStore, MinMaxSurroundAttestation} from "./interface.js";
import {SurroundAttestationError, SurroundAttestationErrorCode} from "./errors.js";

// surround vote checking with min-max surround
// https://github.com/protolambda/eth2-surround#min-max-surround

/**
 * Number of epochs in the past to check for surrounding attestations.
 *
 * This value can be limited to a reasonable high amount as Lodestar does not solely rely on this strategy but also
 * implements the minimal strategy which has been formally proven to be safe (https://github.com/michaelsproul/slashing-proofs).
 *
 * Limiting this value is required due to practical reasons as otherwise there would be a min-span DB read and write
 * for each validator from current epoch until genesis which massively increases DB size and causes I/O lag, resulting in
 * instability on first startup with an empty DB. See https://github.com/ChainSafe/lodestar/issues/5356 for more details.
 *
 * The value 4096 has been chosen as it is the default used by slashers (https://lighthouse-book.sigmaprime.io/slasher.html#history-length)
 * and is generally higher than the weak subjectivity period. However, it would still be risky if we just relied on min-max surround
 * for slashing protection, as slashers can be configured to collect slashable attestations over a longer period.
 */
const DEFAULT_MAX_EPOCH_LOOKBACK = 4096;

export class MinMaxSurround implements IMinMaxSurround {
  private store: IDistanceStore;
  private maxEpochLookback: number;

  constructor(store: IDistanceStore, options?: {maxEpochLookback?: number}) {
    this.store = store;
    this.maxEpochLookback = options?.maxEpochLookback ?? DEFAULT_MAX_EPOCH_LOOKBACK;
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

    const values: DistanceEntry[] = [];
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

    const values: DistanceEntry[] = [];
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
