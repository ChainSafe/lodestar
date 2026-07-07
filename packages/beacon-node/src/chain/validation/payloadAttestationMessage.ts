import {
  computeEpochAtSlot,
  createSingleSignatureSetFromComponents,
  getPayloadAttestationDataSigningRoot,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {RootHex, gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import type {BeaconEngine} from "../beaconEngine/beaconEngine.js";
import {GossipAction, PayloadAttestationError, PayloadAttestationErrorCode} from "../errors/index.js";
import {RegenCaller} from "../regen/index.js";

export type PayloadAttestationValidationResult = {
  attDataRootHex: RootHex;
  validatorCommitteeIndices: number[];
};

export async function validateApiPayloadAttestationMessage(
  this: BeaconEngine,
  payloadAttestationMessage: gloas.PayloadAttestationMessage
): Promise<PayloadAttestationValidationResult> {
  const prioritizeBls = true;
  return validatePayloadAttestationMessage.call(this, payloadAttestationMessage, prioritizeBls);
}

export async function validateGossipPayloadAttestationMessage(
  this: BeaconEngine,
  payloadAttestationMessage: gloas.PayloadAttestationMessage
): Promise<PayloadAttestationValidationResult> {
  return validatePayloadAttestationMessage.call(this, payloadAttestationMessage);
}

async function validatePayloadAttestationMessage(
  this: BeaconEngine,
  payloadAttestationMessage: gloas.PayloadAttestationMessage,
  prioritizeBls = false
): Promise<PayloadAttestationValidationResult> {
  const {data, validatorIndex} = payloadAttestationMessage;
  const epoch = computeEpochAtSlot(data.slot);

  // [IGNORE] The message's slot is for the current slot (with a `MAXIMUM_GOSSIP_CLOCK_DISPARITY` allowance), i.e. `data.slot == current_slot`.
  if (!this.clock.isCurrentSlotGivenGossipDisparity(data.slot)) {
    throw new PayloadAttestationError(GossipAction.IGNORE, {
      code: PayloadAttestationErrorCode.NOT_CURRENT_SLOT,
      currentSlot: this.clock.currentSlot,
      slot: data.slot,
    });
  }

  // [IGNORE] The `payload_attestation_message` is the first valid message received
  // from the validator with index `payload_attestation_message.validator_index`.
  // A single validator can participate PTC at most once per epoch
  if (this.seenPayloadAttesters.isKnown(epoch, validatorIndex)) {
    throw new PayloadAttestationError(GossipAction.IGNORE, {
      code: PayloadAttestationErrorCode.PAYLOAD_ATTESTATION_ALREADY_KNOWN,
      validatorIndex,
      slot: data.slot,
      blockRoot: toRootHex(data.beaconBlockRoot),
    });
  }

  // [IGNORE] The message's block `data.beacon_block_root` has been seen (via
  // gossip or non-gossip sources) (a client MAY queue attestation for processing
  // once the block is retrieved. Note a client might want to request payload after).
  const block = this.forkChoice.getBlockDefaultStatus(data.beaconBlockRoot);
  if (!block) {
    throw new PayloadAttestationError(GossipAction.IGNORE, {
      code: PayloadAttestationErrorCode.UNKNOWN_BLOCK_ROOT,
      blockRoot: toRootHex(data.beaconBlockRoot),
    });
  }

  // [IGNORE] The block referenced by `data.beacon_block_root` is at slot `data.slot`,
  // i.e. the block has `block.slot == data.slot`.
  if (block.slot !== data.slot) {
    throw new PayloadAttestationError(GossipAction.IGNORE, {
      code: PayloadAttestationErrorCode.INVALID_BLOCK_SLOT,
      blockRoot: toRootHex(data.beaconBlockRoot),
      blockSlot: block.slot,
      slot: data.slot,
    });
  }

  // [REJECT] The message's block `data.beacon_block_root` passes validation.
  // TODO GLOAS: implement this. Technically if we cannot get proto block from fork choice,
  // it is possible that the block didn't pass the validation

  // Use the referenced block's branch state for the PTC committee check
  const state = await this.regen
    .getBlockSlotState(block, data.slot, {dontTransferCache: true}, RegenCaller.validateGossipPayloadAttestationMessage)
    .catch(() => {
      throw new PayloadAttestationError(GossipAction.IGNORE, {
        code: PayloadAttestationErrorCode.UNKNOWN_BLOCK_ROOT,
        blockRoot: toRootHex(data.beaconBlockRoot),
      });
    });

  if (!isStatePostGloas(state)) {
    throw new Error(`Expected gloas+ state for payload attestation validation, got fork=${state.forkName}`);
  }

  // [REJECT] The message's validator index is within the payload committee in
  // `get_ptc(state, data.slot)`. The `state` is the head state corresponding to
  // processing the block up to the current slot as determined by the fork choice.
  // The validator may occupy multiple PTC positions because `compute_ptc` samples
  // by effective balance — collect all of them so duplicate votes are counted.
  const validatorCommitteeIndices = state.getIndicesInPayloadTimelinessCommittee(validatorIndex, data.slot);

  if (validatorCommitteeIndices.length === 0) {
    throw new PayloadAttestationError(GossipAction.REJECT, {
      code: PayloadAttestationErrorCode.INVALID_ATTESTER,
      attesterIndex: validatorIndex,
    });
  }

  // [REJECT] `payload_attestation_message.signature` is valid with respect to the validator's public key.
  const validatorPubkey = this.pubkeyCache.get(validatorIndex);
  if (!validatorPubkey) {
    throw new PayloadAttestationError(GossipAction.REJECT, {
      code: PayloadAttestationErrorCode.INVALID_ATTESTER,
      attesterIndex: validatorIndex,
    });
  }

  const signatureSet = createSingleSignatureSetFromComponents(
    validatorPubkey,
    getPayloadAttestationDataSigningRoot(this.config, data),
    payloadAttestationMessage.signature
  );

  if (!(await this.bls.verifySignatureSets([signatureSet], {batchable: true, priority: prioritizeBls}))) {
    throw new PayloadAttestationError(GossipAction.REJECT, {
      code: PayloadAttestationErrorCode.INVALID_SIGNATURE,
    });
  }

  // Valid
  this.seenPayloadAttesters.add(epoch, validatorIndex);

  return {
    attDataRootHex: toRootHex(ssz.gloas.PayloadAttestationData.hashTreeRoot(data)),
    validatorCommitteeIndices,
  };
}
