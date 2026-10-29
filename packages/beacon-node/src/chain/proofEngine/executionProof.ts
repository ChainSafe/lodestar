import {ContainerType, ProgressiveListCompositeType} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {ForkName, ForkPostGloas, STATELESS_INPUT_SCHEMA_ID} from "@lodestar/params";
import {Slot, eip8025, gloas, ssz} from "@lodestar/types";
import {PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput/index.js";

/** Which `hash_tree_root(NewPayloadRequest)` a public input commits to */
export type PublicInputConvention = "spec" | "execution_specs";

export type PublicInputCandidate = {convention: PublicInputConvention; publicInput: eip8025.PublicInput};

/** The spec `ExecutionProof` plus every public input the engine may accept for it, the spec one first */
export type ExecutionProofInput = {
  proof: eip8025.ExecutionProof;
  publicInputs: readonly PublicInputCandidate[];
};

type NewPayloadRequestHasher = {hashTreeRoot(value: gloas.NewPayloadRequest): Uint8Array};

/**
 * `NewPayloadRequest` as execution-specs `stateless.py`, the ere-guests and eth-act/lighthouse hash it: a plain
 * container whose `versioned_hashes` is a `ProgressiveList`. The consensus spec hashes a `ProgressiveContainer`
 * over the bounded Deneb list instead, so the proofs today's provers publish commit to this root.
 */
const executionSpecsNewPayloadRequestTypes = new Map<ForkName, NewPayloadRequestHasher>();

export function getExecutionSpecsNewPayloadRequestRoot(
  config: ChainForkConfig,
  slot: Slot,
  newPayloadRequest: gloas.NewPayloadRequest
): Uint8Array {
  const fork = config.getForkName(slot);
  let type = executionSpecsNewPayloadRequestTypes.get(fork);
  if (type === undefined) {
    const specType = config.getForkTypes<ForkPostGloas>(slot).NewPayloadRequest as typeof ssz.gloas.NewPayloadRequest;
    type = new ContainerType(
      {
        ...specType.fields,
        versionedHashes: new ProgressiveListCompositeType(ssz.deneb.VersionedHash, {typeName: "VersionedHashes"}),
      },
      {typeName: "NewPayloadRequest", jsonCase: "eth2"}
    );
    executionSpecsNewPayloadRequestTypes.set(fork, type);
  }
  return type.hashTreeRoot(newPayloadRequest);
}

export function getExecutionProof(
  config: ChainForkConfig,
  payloadInput: PayloadEnvelopeInput,
  proofEnvelope: eip8025.ExecutionProofEnvelope
): ExecutionProofInput {
  const payloadEnvelope = payloadInput.getPayloadEnvelope().message;
  const newPayloadRequest: gloas.NewPayloadRequest = {
    executionPayload: payloadEnvelope.payload,
    versionedHashes: payloadInput.getVersionedHashes(),
    parentBeaconBlockRoot: payloadEnvelope.parentBeaconBlockRoot,
    executionRequests: payloadEnvelope.executionRequests,
  };
  const publicInput = (newPayloadRequestRoot: Uint8Array): eip8025.PublicInput => ({
    newPayloadRequestRoot,
    successfulValidation: true,
    chainId: BigInt(config.DEPOSIT_CHAIN_ID),
    schemaId: STATELESS_INPUT_SCHEMA_ID,
  });
  const spec = publicInput(
    config.getForkTypes<ForkPostGloas>(payloadInput.slot).NewPayloadRequest.hashTreeRoot(newPayloadRequest)
  );
  const executionSpecs = publicInput(
    getExecutionSpecsNewPayloadRequestRoot(config, payloadInput.slot, newPayloadRequest)
  );

  return {
    proof: {proofData: proofEnvelope.proofData, proofType: proofEnvelope.proofType, publicInput: spec},
    publicInputs: [
      {convention: "spec", publicInput: spec},
      {convention: "execution_specs", publicInput: executionSpecs},
    ],
  };
}
