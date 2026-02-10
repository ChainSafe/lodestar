import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_BUILDER} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {computeSigningRoot} from "../util/index.js";

export function getExecutionPayloadEnvelopeSigningRoot(
  config: BeaconConfig,
  envelope: gloas.ExecutionPayloadEnvelope
): Uint8Array {
  const domain = config.getDomain(envelope.slot, DOMAIN_BEACON_BUILDER);

  return computeSigningRoot(ssz.gloas.ExecutionPayloadEnvelope, envelope, domain);
}
