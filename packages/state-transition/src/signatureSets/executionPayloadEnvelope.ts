import {PublicKey} from "@chainsafe/blst";
import {BeaconConfig} from "@lodestar/config";
import {BUILDER_INDEX_SELF_BUILD, DOMAIN_BEACON_BUILDER} from "@lodestar/params";
import {ValidatorIndex, gloas, ssz} from "@lodestar/types";
<<<<<<< HEAD
import {PubkeyCache} from "../cache/pubkeyCache.js";
import {IBeaconStateView} from "../stateView/interface.js";
=======
import {PubkeyCache} from "../cache/pubkeyCache.ts";
import {IBeaconStateView} from "../stateView/interface.js";
import {CachedBeaconStateGloas} from "../types.js";
>>>>>>> e5ddd309fc (fix: support IBeaconStateView for getExecutionPayloadEnvelopeSignatureSet())
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
  const envelope = signedEnvelope.message;
  const pubkey =
    envelope.builderIndex === BUILDER_INDEX_SELF_BUILD
      ? pubkeyCache.getOrThrow(proposerIndex)
      : PublicKey.fromBytes(state.getBuilder(envelope.builderIndex).pubkey);

  return createSingleSignatureSetFromComponents(
    pubkey,
    getExecutionPayloadEnvelopeSigningRoot(config, envelope),
    signedEnvelope.signature
  );
}

function isBeaconStateView(state: CachedBeaconStateGloas | IBeaconStateView): state is IBeaconStateView {
  return "getBuilder" in state;
}
