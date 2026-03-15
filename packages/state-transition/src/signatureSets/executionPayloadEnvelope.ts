import {PublicKey} from "@chainsafe/blst";
import {BeaconConfig} from "@lodestar/config";
import {BUILDER_INDEX_SELF_BUILD, DOMAIN_BEACON_BUILDER} from "@lodestar/params";
import {ValidatorIndex, gloas, ssz} from "@lodestar/types";
import {CachedBeaconStateGloas} from "../types.js";
import {computeSigningRoot} from "../util/index.js";
import {type SingleSignatureSet, createSingleSignatureSetFromComponents} from "../util/signatureSets.js";

export function getExecutionPayloadEnvelopeSigningRoot(
  config: BeaconConfig,
  envelope: gloas.ExecutionPayloadEnvelope
): Uint8Array {
  const domain = config.getDomain(envelope.slot, DOMAIN_BEACON_BUILDER);

  return computeSigningRoot(ssz.gloas.ExecutionPayloadEnvelope, envelope, domain);
}

export function getExecutionPayloadEnvelopeSignatureSet(
  config: BeaconConfig,
  state: CachedBeaconStateGloas,
  signedEnvelope: gloas.SignedExecutionPayloadEnvelope,
  proposerIndex: ValidatorIndex
): SingleSignatureSet {
  const envelope = signedEnvelope.message;
  const pubkey =
    envelope.builderIndex === BUILDER_INDEX_SELF_BUILD
      ? state.epochCtx.pubkeyCache.getOrThrow(proposerIndex)
      : PublicKey.fromBytes(state.builders.getReadonly(envelope.builderIndex).pubkey);

  return createSingleSignatureSetFromComponents(
    pubkey,
    getExecutionPayloadEnvelopeSigningRoot(config, envelope),
    signedEnvelope.signature
  );
}
