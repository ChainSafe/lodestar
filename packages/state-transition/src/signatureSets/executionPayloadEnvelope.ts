import {PublicKey} from "@chainsafe/blst";
import {BeaconConfig} from "@lodestar/config";
import {BUILDER_INDEX_SELF_BUILD, DOMAIN_BEACON_BUILDER} from "@lodestar/params";
import {ValidatorIndex, gloas, ssz} from "@lodestar/types";
import {PubkeyCache} from "../cache/pubkeyCache.js";
import {IBeaconStateView, isStatePostGloas} from "../stateView/interface.js";
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
  pubkeyCache: PubkeyCache,
  state: IBeaconStateView,
  signedEnvelope: gloas.SignedExecutionPayloadEnvelope,
  proposerIndex: ValidatorIndex
): SingleSignatureSet {
  if (!isStatePostGloas(state)) {
    throw new Error(`Expected gloas+ state for execution payload envelope signature, got fork=${state.forkName}`);
  }

  const envelope = signedEnvelope.message;
  let pubkey: PublicKey;

  if (envelope.builderIndex === BUILDER_INDEX_SELF_BUILD) {
    pubkey = pubkeyCache.getOrThrow(proposerIndex);
  } else {
    pubkey = PublicKey.fromBytes(state.getBuilder(envelope.builderIndex).pubkey);
  }

  return createSingleSignatureSetFromComponents(
    pubkey,
    getExecutionPayloadEnvelopeSigningRoot(config, envelope),
    signedEnvelope.signature
  );
}
