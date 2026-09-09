import {BeaconConfig} from "@lodestar/config";
import {BUILDER_INDEX_SELF_BUILD, DOMAIN_BEACON_BUILDER} from "@lodestar/params";
import {ValidatorIndex, gloas, ssz} from "@lodestar/types";
import {IBeaconStateView, isStatePostGloas} from "../stateView/interface.js";
import {computeSigningRoot} from "../util/index.js";
import {
  type ISignatureSet,
  createIndexedSignatureSetFromComponents,
  createSingleSignatureSetFromComponents,
} from "../util/signatureSets.js";

export function getExecutionPayloadEnvelopeSigningRoot(
  config: BeaconConfig,
  envelope: gloas.ExecutionPayloadEnvelope
): Uint8Array {
  const domain = config.getDomain(envelope.payload.slotNumber, DOMAIN_BEACON_BUILDER);

  return computeSigningRoot(ssz.gloas.ExecutionPayloadEnvelope, envelope, domain);
}

export function getExecutionPayloadEnvelopeSignatureSet(
  config: BeaconConfig,
  state: IBeaconStateView,
  signedEnvelope: gloas.SignedExecutionPayloadEnvelope,
  proposerIndex: ValidatorIndex
): ISignatureSet {
  if (!isStatePostGloas(state)) {
    throw new Error(`Expected gloas+ state for execution payload envelope signature, got fork=${state.forkName}`);
  }

  const envelope = signedEnvelope.message;
  const signingRoot = getExecutionPayloadEnvelopeSigningRoot(config, envelope);
  return envelope.builderIndex === BUILDER_INDEX_SELF_BUILD
    ? createIndexedSignatureSetFromComponents(proposerIndex, signingRoot, signedEnvelope.signature)
    : createSingleSignatureSetFromComponents(
        state.getBuilder(envelope.builderIndex).pubkey,
        signingRoot,
        signedEnvelope.signature
      );
}
