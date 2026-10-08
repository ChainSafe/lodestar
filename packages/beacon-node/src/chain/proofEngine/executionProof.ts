import {ChainForkConfig} from "@lodestar/config";
import {ForkPostGloas, STATELESS_INPUT_SCHEMA_ID} from "@lodestar/params";
import {eip8025, gloas} from "@lodestar/types";
import {PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput/index.js";

export function getExecutionProof(
  config: ChainForkConfig,
  payloadInput: PayloadEnvelopeInput,
  proofEnvelope: eip8025.ExecutionProofEnvelope
): eip8025.ExecutionProof {
  const payloadEnvelope = payloadInput.getPayloadEnvelope().message;
  const newPayloadRequest: gloas.NewPayloadRequest = {
    executionPayload: payloadEnvelope.payload,
    versionedHashes: payloadInput.getVersionedHashes(),
    parentBeaconBlockRoot: payloadEnvelope.parentBeaconBlockRoot,
    executionRequests: payloadEnvelope.executionRequests,
  };

  return {
    proofData: proofEnvelope.proofData,
    proofType: proofEnvelope.proofType,
    publicInput: {
      newPayloadRequestRoot: config
        .getForkTypes<ForkPostGloas>(payloadInput.slot)
        .NewPayloadRequest.hashTreeRoot(newPayloadRequest),
      successfulValidation: true,
      chainId: config.DEPOSIT_CHAIN_ID,
      schemaId: STATELESS_INPUT_SCHEMA_ID,
    },
  };
}
