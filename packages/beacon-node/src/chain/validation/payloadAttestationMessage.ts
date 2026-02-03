import {
  CachedBeaconStateGloas,
  computeEpochAtSlot,
  createSingleSignatureSetFromComponents,
  getPayloadAttestationDataSigningRoot,
} from "@lodestar/state-transition";
import {RootHex, gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {GossipAction, PayloadAttestationError, PayloadAttestationErrorCode} from "../errors/index.js";
import {IBeaconChain} from "../index.js";

export type PayloadAttestationValidationResult = {
  attDataRootHex: RootHex;
  validatorCommitteeIndex: number;
};

export async function validateApiPayloadAttestationMessage(
  chain: IBeaconChain,
  payloadAttestationMessage: gloas.PayloadAttestationMessage
): Promise<PayloadAttestationValidationResult> {
  return validatePayloadAttestationMessage(chain, payloadAttestationMessage);
}

export async function validateGossipPayloadAttestationMessage(
  chain: IBeaconChain,
  payloadAttestationMessage: gloas.PayloadAttestationMessage
): Promise<PayloadAttestationValidationResult> {
  return validatePayloadAttestationMessage(chain, payloadAttestationMessage);
}

async function validatePayloadAttestationMessage(
  chain: IBeaconChain,
  payloadAttestationMessage: gloas.PayloadAttestationMessage
): Promise<PayloadAttestationValidationResult> {
  const {data, validatorIndex} = payloadAttestationMessage;
  const epoch = computeEpochAtSlot(data.slot);

  // [IGNORE] The message's slot is for the current slot (with a `MAXIMUM_GOSSIP_CLOCK_DISPARITY` allowance), i.e. `data.slot == current_slot`.
  if (!chain.clock.isCurrentSlotGivenGossipDisparity(data.slot)) {
    throw new PayloadAttestationError(GossipAction.IGNORE, {
      code: PayloadAttestationErrorCode.NOT_CURRENT_SLOT,
      currentSlot: chain.clock.currentSlot,
      slot: data.slot,
    });
  }

  // [IGNORE] The `payload_attestation_message` is the first valid message received
  // from the validator with index `payload_attestation_message.validator_index`.
  // A single validator can participate PTC at most once per epoch
  if (chain.seenPayloadAttesters.isKnown(epoch, validatorIndex)) {
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
  const block = chain.forkChoice.getBlock(data.beaconBlockRoot);
  if (block === null) {
    throw new PayloadAttestationError(GossipAction.IGNORE, {
      code: PayloadAttestationErrorCode.UNKNOWN_BLOCK_ROOT,
      blockRoot: toRootHex(data.beaconBlockRoot),
    });
  }

  const state = chain.getHeadState() as CachedBeaconStateGloas;

  // [REJECT] The message's block `data.beacon_block_root` passes validation.
  // TODO GLOAS: implement this. Technically if we cannot get proto block from fork choice,
  // it is possible that the block didn't pass the validation

  // [REJECT] The message's validator index is within the payload committee in
  // `get_ptc(state, data.slot)`. The `state` is the head state corresponding to
  // processing the block up to the current slot as determined by the fork choice.
  const ptc = state.epochCtx.getPayloadTimelinessCommittee(data.slot);
  const validatorCommitteeIndex = ptc.indexOf(validatorIndex);

  if (validatorCommitteeIndex === -1) {
    throw new PayloadAttestationError(GossipAction.REJECT, {
      code: PayloadAttestationErrorCode.INVALID_ATTESTER,
      attesterIndex: validatorIndex,
    });
  }

  // [REJECT] `payload_attestation_message.signature` is valid with respect to the validator's public key.
  const signatureSet = createSingleSignatureSetFromComponents(
    chain.index2pubkey[validatorIndex],
    getPayloadAttestationDataSigningRoot(chain.config, state.slot, data),
    payloadAttestationMessage.signature
  );

  if (!(await chain.bls.verifySignatureSets([signatureSet]))) {
    throw new PayloadAttestationError(GossipAction.REJECT, {
      code: PayloadAttestationErrorCode.INVALID_SIGNATURE,
    });
  }

  // Valid
  chain.seenPayloadAttesters.add(epoch, validatorIndex);

  return {
    attDataRootHex: toRootHex(ssz.gloas.PayloadAttestationData.hashTreeRoot(data)),
    validatorCommitteeIndex,
  };
}
