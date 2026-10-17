import {BLSPubkey, Epoch} from "@lodestar/types";
import {SurroundAttestationError, SurroundAttestationErrorCode} from "./errors.js";
import {DistanceEntry, IDistanceStore, IMinMaxSurround, MinMaxSurroundAttestation, SpanUpdates} from "./interface.js";

// surround vote checking with min-max surround
// https://github.com/protolambda/eth2-surround#min-max-surround

/**
 * Number of epochs in the past to check for surrounding attestations.
 *
 * This value can be limited to a reasonable high amount as Lodestar does not solely rely on this strategy but also
 * rejects any source epoch below `minSpanCoverageStart` of the latest recorded attestation, which is the minimal
 * strategy (formally proven safe, https://github.com/michaelsproul/slashing-proofs) relaxed by this lookback.
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

  /** Lowest epoch with a min-span entry after inserting an attestation with `sourceEpoch` */
  minSpanCoverageStart(sourceEpoch: Epoch): Epoch {
    return Math.max(0, sourceEpoch - 1 - this.maxEpochLookback);
  }

  async assertNoSurround(pubKey: BLSPubkey, attestation: MinMaxSurroundAttestation): Promise<void> {
    await this.assertNotSurrounding(pubKey, attestation);
    await this.assertNotSurrounded(pubKey, attestation);
  }

  async insertAttestation(pubKey: BLSPubkey, attestation: MinMaxSurroundAttestation): Promise<void> {
    await this.store.setBatch(pubKey, await this.prepareAttestation(pubKey, attestation));
  }

  /** The caller must serialize preparation and commit for each public key. */
  async prepareAttestation(pubKey: BLSPubkey, attestation: MinMaxSurroundAttestation): Promise<SpanUpdates> {
    return {
      minSpan: await this.minSpanUpdates(pubKey, attestation),
      maxSpan: await this.maxSpanUpdates(pubKey, attestation),
    };
  }

  /** The caller must serialize preparation and commit for each public key. */
  async prepareAttestations(
    pubKey: BLSPubkey,
    attestations: readonly MinMaxSurroundAttestation[]
  ): Promise<SpanUpdates> {
    const minSpan = new Map<Epoch, Epoch>();
    const maxSpan = new Map<Epoch, Epoch>();
    const staged = new MinMaxSurround(
      {
        minSpan: {get: async (_, epoch) => minSpan.get(epoch) ?? this.store.minSpan.get(pubKey, epoch)},
        maxSpan: {get: async (_, epoch) => maxSpan.get(epoch) ?? this.store.maxSpan.get(pubKey, epoch)},
        setBatch: async (_, updates) => {
          for (const {source, distance} of updates.minSpan) minSpan.set(source, distance);
          for (const {source, distance} of updates.maxSpan) maxSpan.set(source, distance);
        },
      },
      {maxEpochLookback: this.maxEpochLookback}
    );
    for (const attestation of attestations) await staged.insertAttestation(pubKey, attestation);
    return {
      minSpan: Array.from(minSpan, ([source, distance]) => ({source, distance})),
      maxSpan: Array.from(maxSpan, ([source, distance]) => ({source, distance})),
    };
  }

  // min span

  private async minSpanUpdates(pubKey: BLSPubkey, attestation: MinMaxSurroundAttestation): Promise<DistanceEntry[]> {
    await this.assertNotSurrounding(pubKey, attestation);

    const untilEpoch = this.minSpanCoverageStart(attestation.sourceEpoch);

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
    return values;
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

  private async maxSpanUpdates(pubKey: BLSPubkey, attestation: MinMaxSurroundAttestation): Promise<DistanceEntry[]> {
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
    return values;
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
