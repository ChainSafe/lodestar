import {describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {STATELESS_INPUT_SCHEMA_ID} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/index.js";
import {getExecutionProof} from "../../../../src/chain/proofEngine/executionProof.js";

describe("getExecutionProof", () => {
  const config = createChainForkConfig({
    ...configDef,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: 0,
  });

  it("commits the public input to the NewPayloadRequest of the accepted payload", () => {
    const signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    signedEnvelope.message.payload.slotNumber = 3;
    signedEnvelope.message.payload.blockHash = Buffer.alloc(32, 5);
    signedEnvelope.message.parentBeaconBlockRoot = Buffer.alloc(32, 7);
    const versionedHashes = [Buffer.alloc(32, 9)];
    const payloadInput = {
      slot: 3,
      getPayloadEnvelope: () => signedEnvelope,
      getVersionedHashes: () => versionedHashes,
    } as unknown as PayloadEnvelopeInput;
    const proofEnvelope = {proofData: Uint8Array.from([1, 2, 3]), proofType: 2, beaconBlockRoot: Buffer.alloc(32, 1)};

    const proof = getExecutionProof(config, payloadInput, proofEnvelope);

    expect(proof.proofData).toBe(proofEnvelope.proofData);
    expect(proof.proofType).toBe(2);
    expect(proof.publicInput).toEqual({
      newPayloadRequestRoot: ssz.gloas.NewPayloadRequest.hashTreeRoot({
        executionPayload: signedEnvelope.message.payload,
        versionedHashes,
        parentBeaconBlockRoot: signedEnvelope.message.parentBeaconBlockRoot,
        executionRequests: signedEnvelope.message.executionRequests,
      }),
      successfulValidation: true,
      chainId: config.DEPOSIT_CHAIN_ID,
      schemaId: STATELESS_INPUT_SCHEMA_ID,
    });
    expect(ssz.eip8025.PublicInput.serialize(proof.publicInput)).toHaveLength(43);
  });
});
