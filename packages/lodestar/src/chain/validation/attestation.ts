import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../../db";
import {IAttestationJob, IBeaconChain} from "..";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {AttestationGossipError, AttestationErrorCode, GossipAction} from "../errors";
import {ATTESTATION_PROPAGATION_SLOT_RANGE} from "../../constants";

export async function validateGossipAttestation(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  attestationJob: IAttestationJob,
  subnet: number
): Promise<void> {
  const attestation = attestationJob.attestation;

  const attestationTargetState = await chain.regen.getCheckpointState(attestation.data.target).catch((e) => {
    throw new AttestationGossipError(GossipAction.IGNORE, {
      code: AttestationErrorCode.MISSING_ATTESTATION_TARGET_STATE,
      error: e as Error,
      job: attestationJob,
    });
  });

  // Note: no need to verify isValidIndexedAttestation(), we just created the indexedAttestation here
  const indexedAttestation = attestationTargetState.getIndexedAttestation(attestation);

  // [REJECT] The committee index is within the expected range
  // -- i.e. data.index < get_committee_count_per_slot(state, data.target.epoch)
  try {
    if (attestation.data.index >= attestationTargetState.getCommitteeCountAtSlot(attestation.data.slot)) {
      throw Error("COMMITTEE_INDEX_OUT_OF_RANGE");
    }
  } catch (error) {
    throw new AttestationGossipError(GossipAction.REJECT, {
      code: AttestationErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE,
      index: attestation.data.index,
      job: attestationJob,
    });
  }

  // [REJECT] The attestation is for the correct subnet
  // -- i.e. compute_subnet_for_attestation(committees_per_slot, attestation.data.slot, attestation.data.index) == subnet_id,
  // where committees_per_slot = get_committee_count_per_slot(state, attestation.data.target.epoch),
  // which may be pre-computed along with the committee information for the signature check.
  const expectedSubnet = allForks.computeSubnetForAttestation(config, attestationTargetState, attestation);
  if (subnet !== expectedSubnet) {
    throw new AttestationGossipError(GossipAction.REJECT, {
      code: AttestationErrorCode.INVALID_SUBNET_ID,
      received: subnet,
      expected: expectedSubnet,
      job: attestationJob,
    });
  }

  // [IGNORE] attestation.data.slot is within the last ATTESTATION_PROPAGATION_SLOT_RANGE slots (within a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
  //  -- i.e. attestation.data.slot + ATTESTATION_PROPAGATION_SLOT_RANGE >= current_slot >= attestation.data.slot
  // (a client MAY queue future attestations for processing at the appropriate slot).
  const latestPermissibleSlot = chain.clock.currentSlot;
  const earliestPermissibleSlot = chain.clock.currentSlot - ATTESTATION_PROPAGATION_SLOT_RANGE;
  const attestationSlot = attestation.data.slot;
  if (attestationSlot < earliestPermissibleSlot) {
    throw new AttestationGossipError(GossipAction.IGNORE, {
      code: AttestationErrorCode.PAST_SLOT,
      earliestPermissibleSlot,
      attestationSlot,
      job: attestationJob,
    });
  }
  if (attestationSlot > latestPermissibleSlot) {
    throw new AttestationGossipError(GossipAction.IGNORE, {
      code: AttestationErrorCode.FUTURE_SLOT,
      latestPermissibleSlot,
      attestationSlot,
      job: attestationJob,
    });
  }

  // [REJECT] The attestation's epoch matches its target -- i.e. attestation.data.target.epoch == compute_epoch_at_slot(attestation.data.slot)
  if (!config.types.Epoch.equals(attestation.data.target.epoch, computeEpochAtSlot(config, attestationSlot))) {
    throw new AttestationGossipError(GossipAction.REJECT, {
      code: AttestationErrorCode.BAD_TARGET_EPOCH,
      job: attestationJob,
    });
  }

  // [REJECT] The attestation is unaggregated -- that is, it has exactly one participating validator
  // (len([bit for bit in attestation.aggregation_bits if bit]) == 1, i.e. exactly 1 bit is set).
  if (indexedAttestation.attestingIndices.length !== 1) {
    throw new AttestationGossipError(GossipAction.REJECT, {
      code: AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET,
      numBits: indexedAttestation.attestingIndices.length,
      job: attestationJob,
    });
  }

  // [REJECT] The number of aggregation bits matches the committee size
  // -- i.e. len(attestation.aggregation_bits) == len(get_beacon_committee(state, data.slot, data.index)).
  if (
    attestation.aggregationBits.length !==
    attestationTargetState.getBeaconCommittee(attestation.data.slot, attestation.data.index).length
  ) {
    throw new AttestationGossipError(GossipAction.REJECT, {
      code: AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS,
      job: attestationJob,
    });
  }

  // [IGNORE] There has been no other valid attestation seen on an attestation subnet that has an
  // identical attestation.data.target.epoch and participating validator index.
  //
  // no other validator attestation for same target epoch has been seen
  if (db.seenAttestationCache.hasCommitteeAttestation(attestation)) {
    throw new AttestationGossipError(GossipAction.IGNORE, {
      code: AttestationErrorCode.ATTESTATION_ALREADY_KNOWN,
      root: config.types.phase0.Attestation.hashTreeRoot(attestation),
      job: attestationJob,
    });
  }

  // [IGNORE] The block being voted for (attestation.data.beacon_block_root) has been seen (via both gossip
  // and non-gossip sources) (a client MAY queue attestations for processing once block is retrieved).
  if (!chain.forkChoice.hasBlock(attestation.data.beaconBlockRoot)) {
    throw new AttestationGossipError(GossipAction.IGNORE, {
      code: AttestationErrorCode.UNKNOWN_BEACON_BLOCK_ROOT,
      beaconBlockRoot: attestation.data.beaconBlockRoot as Uint8Array,
      job: attestationJob,
    });
  }

  // [REJECT] The block being voted for (attestation.data.beacon_block_root) passes validation.
  if (await db.badBlock.has(attestation.data.beaconBlockRoot.valueOf() as Uint8Array)) {
    throw new AttestationGossipError(GossipAction.REJECT, {
      code: AttestationErrorCode.KNOWN_BAD_BLOCK,
      job: attestationJob,
    });
  }

  // [REJECT] The attestation's target block is an ancestor of the block named in the LMD vote
  //  --i.e. get_ancestor(store, attestation.data.beacon_block_root, compute_start_slot_at_epoch(attestation.data.target.epoch)) == attestation.data.target.root
  if (!chain.forkChoice.isDescendant(attestation.data.target.root, attestation.data.beaconBlockRoot)) {
    throw new AttestationGossipError(GossipAction.REJECT, {
      code: AttestationErrorCode.TARGET_BLOCK_NOT_AN_ANCESTOR_OF_LMD_BLOCK,
      job: attestationJob,
    });
  }

  // [REJECT] The current finalized_checkpoint is an ancestor of the block defined by attestation.data.beacon_block_root
  // -- i.e. get_ancestor(store, attestation.data.beacon_block_root, compute_start_slot_at_epoch(store.finalized_checkpoint.epoch)) == store.finalized_checkpoint.root
  if (!chain.forkChoice.isDescendantOfFinalized(attestation.data.beaconBlockRoot)) {
    throw new AttestationGossipError(GossipAction.REJECT, {
      code: AttestationErrorCode.FINALIZED_CHECKPOINT_NOT_AN_ANCESTOR_OF_ROOT,
      job: attestationJob,
    });
  }

  // [REJECT] The signature of attestation is valid.
  if (!attestationJob.validSignature) {
    const signatureSet = allForks.getIndexedAttestationSignatureSet(attestationTargetState, indexedAttestation);
    if (!(await chain.bls.verifySignatureSets([signatureSet]))) {
      throw new AttestationGossipError(GossipAction.REJECT, {
        code: AttestationErrorCode.INVALID_SIGNATURE,
        job: attestationJob,
      });
    }
  }

  db.seenAttestationCache.addCommitteeAttestation(attestation);
}
