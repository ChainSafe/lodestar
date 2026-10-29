import {describe, expect, it} from "vitest";
import {digest} from "@chainsafe/as-sha256";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {STATELESS_INPUT_SCHEMA_ID} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/index.js";
import {
  getExecutionProof,
  getExecutionSpecsNewPayloadRequestRoot,
} from "../../../../src/chain/proofEngine/executionProof.js";

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

  it("commits the public inputs to the NewPayloadRequest of the accepted payload under both root conventions", () => {
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
    const newPayloadRequest = {
      executionPayload: signedEnvelope.message.payload,
      versionedHashes,
      parentBeaconBlockRoot: signedEnvelope.message.parentBeaconBlockRoot,
      executionRequests: signedEnvelope.message.executionRequests,
    };

    const {proof, publicInputs} = getExecutionProof(config, payloadInput, proofEnvelope);

    expect(proof.proofData).toBe(proofEnvelope.proofData);
    expect(proof.proofType).toBe(2);
    expect(proof.publicInput).toEqual({
      newPayloadRequestRoot: ssz.gloas.NewPayloadRequest.hashTreeRoot(newPayloadRequest),
      successfulValidation: true,
      chainId: BigInt(config.DEPOSIT_CHAIN_ID),
      schemaId: STATELESS_INPUT_SCHEMA_ID,
    });
    expect(ssz.eip8025.PublicInput.serialize(proof.publicInput)).toHaveLength(43);
    expect(publicInputs.map(({convention}) => convention)).toEqual(["spec", "execution_specs"]);
    expect(publicInputs[0].publicInput).toBe(proof.publicInput);
    expect(publicInputs[1].publicInput).toEqual({
      ...proof.publicInput,
      newPayloadRequestRoot: getExecutionSpecsNewPayloadRequestRoot(config, 3, newPayloadRequest),
    });
    expect(publicInputs[1].publicInput.newPayloadRequestRoot).not.toEqual(proof.publicInput.newPayloadRequestRoot);
  });

  it("reproduces the root eth-act/lighthouse and the ere-guests commit for an empty Gloas payload", () => {
    // eth-act/lighthouse optional-proofs@63a526a, `native_gloas_request_has_eip_8025_tree_hash_root`: the empty
    // envelope with one versioned hash of the empty KZG commitment
    const versionedHash = digest(new Uint8Array(48));
    versionedHash[0] = 0x01;
    const newPayloadRequest = {
      executionPayload: ssz.gloas.ExecutionPayload.defaultValue(),
      versionedHashes: [versionedHash],
      parentBeaconBlockRoot: new Uint8Array(32),
      executionRequests: ssz.gloas.ExecutionRequests.defaultValue(),
    };

    expect(toHex(getExecutionSpecsNewPayloadRequestRoot(config, 0, newPayloadRequest))).toBe(
      "0x4a10be91224e03ff21b4b01fa8f2ca1cfb282628a4232268fd51aec01e9d89e1"
    );
    expect(toHex(ssz.gloas.NewPayloadRequest.hashTreeRoot(newPayloadRequest))).toBe(
      "0x36533e2a25991d56c930da43315cfc2965ae9909d87f5cfc2cda42e4583ca225"
    );
  });
});
