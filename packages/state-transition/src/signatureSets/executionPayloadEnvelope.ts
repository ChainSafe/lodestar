import {PublicKey} from "@chainsafe/blst";
import {BeaconConfig} from "@lodestar/config";
import {BUILDER_INDEX_SELF_BUILD, DOMAIN_BEACON_BUILDER} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {CachedBeaconStateGloas} from "../types.ts";
import {computeSigningRoot} from "../util/index.js";

export function getExecutionPayloadEnvelopeSigningRoot(
  config: BeaconConfig,
  envelope: gloas.ExecutionPayloadEnvelope
): Uint8Array {
  const domain = config.getDomain(envelope.slot, DOMAIN_BEACON_BUILDER);

  return computeSigningRoot(ssz.gloas.ExecutionPayloadEnvelope, envelope, domain);
}

/**
 * Spec equivalent of `verify_execution_payload_envelope_signature` signer selection:
 * - self-build => proposer pubkey from `state.latest_block_header.proposer_index`
 * - external builder => builder pubkey from registry
 */
export function getExecutionPayloadEnvelopeSignerPubkey(
  state: CachedBeaconStateGloas,
  envelope: gloas.ExecutionPayloadEnvelope
): PublicKey {
  if (envelope.builderIndex === BUILDER_INDEX_SELF_BUILD) {
    return state.epochCtx.index2pubkey[state.latestBlockHeader.proposerIndex];
  }

  return PublicKey.fromBytes(state.builders.getReadonly(envelope.builderIndex).pubkey);
}
