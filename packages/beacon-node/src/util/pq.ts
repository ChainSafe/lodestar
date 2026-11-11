import {XMSS_SIGNATURE_SIZE} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";

/** The type of a signed envelope where no slot is at hand: its signature's scheme tells the fork */
export function signedEnvelopeTypeOf(
  signedEnvelope: gloas.SignedExecutionPayloadEnvelope
): typeof ssz.gloas.SignedExecutionPayloadEnvelope {
  return (
    signedEnvelope.signature.length === XMSS_SIGNATURE_SIZE
      ? ssz.pq.SignedExecutionPayloadEnvelope
      : ssz.gloas.SignedExecutionPayloadEnvelope
  ) as typeof ssz.gloas.SignedExecutionPayloadEnvelope;
}
