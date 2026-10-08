import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_EXECUTION_PROOF} from "@lodestar/params";
import {eip8025, ssz} from "@lodestar/types";
import {IBeaconStateView} from "../stateView/interface.js";
import {computeSigningRoot} from "../util/index.js";
import {ISignatureSet, createIndexedSignatureSetFromComponents} from "../util/signatureSets.js";

export function getExecutionProofEnvelopeSigningRoot(
  config: BeaconConfig,
  state: IBeaconStateView,
  proofEnvelope: eip8025.ExecutionProofEnvelope
): Uint8Array {
  const domain = config.getDomain(state.slot, DOMAIN_EXECUTION_PROOF);

  return computeSigningRoot(ssz.eip8025.ExecutionProofEnvelope, proofEnvelope, domain);
}

export function getExecutionProofEnvelopeSignatureSet(
  config: BeaconConfig,
  state: IBeaconStateView,
  signedProofEnvelope: eip8025.SignedExecutionProofEnvelope
): ISignatureSet {
  return createIndexedSignatureSetFromComponents(
    signedProofEnvelope.validatorIndex,
    getExecutionProofEnvelopeSigningRoot(config, state, signedProofEnvelope.message),
    signedProofEnvelope.signature
  );
}
