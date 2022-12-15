/**
 * Worker manager can pull work from this queue such that:
 * - All attestations require the same shuffling
 * - The shuffling required is already available
 *
 * ```py
 * class Attestation(Container):
 *   aggregation_bits: Bitlist[MAX_VALIDATORS_PER_COMMITTEE]
 *   data: AttestationData
 *   signature: BLSSignature
 *
 * class AttestationData(Container):
 *   slot: Slot
 *   index: CommitteeIndex
 *   beacon_block_root: Root
 *   source: Checkpoint
 *   target: Checkpoint
 * ```
 *
 * Attestations must be indexed by the dependant root + epoch of the shuffling, of the target. Or the target itself.
 * They must also be indexed by their slot for easier prunning
 */
export class GossipAttestationQueue {}
