import {beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {FAR_FUTURE_EPOCH, ForkName} from "@lodestar/params";
import {IBeaconStateView} from "@lodestar/state-transition";
import {eip8025, phase0, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/index.js";
import {ExecutionProofErrorCode} from "../../../../src/chain/errors/index.js";
import {validateGossipExecutionProof} from "../../../../src/chain/validation/executionProof.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

describe("validateGossipExecutionProof", () => {
  const config = createBeaconConfig(
    createChainForkConfig({
      ...configDef,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
    }),
    Buffer.alloc(32, 0)
  );
  const blockRoot = Buffer.alloc(32, 1);
  const blockRootHex = toRootHex(blockRoot);
  const blockSlot = 8;
  const validatorCount = 16;
  let chain: MockedBeaconChain;
  let validator: phase0.Validator;
  let signedProof: eip8025.SignedExecutionProofEnvelope;

  beforeEach(() => {
    chain = getMockedBeaconChain({config});
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(
      generateProtoBlock({slot: blockSlot, blockRoot: blockRootHex})
    );
    const signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    vi.mocked(chain.seenPayloadEnvelopeInputCache.getOrReload).mockResolvedValue({
      slot: blockSlot,
      hasPayloadEnvelope: () => true,
      getPayloadEnvelope: () => signedEnvelope,
      getVersionedHashes: () => [],
    } as unknown as PayloadEnvelopeInput);
    validator = ssz.phase0.Validator.defaultValue();
    validator.activationEpoch = 0;
    validator.exitEpoch = FAR_FUTURE_EPOCH;
    chain.regen.getState.mockResolvedValue({
      forkName: ForkName.gloas,
      slot: blockSlot,
      validatorCount,
      getValidator: () => validator,
    } as unknown as IBeaconStateView);

    signedProof = ssz.eip8025.SignedExecutionProofEnvelope.defaultValue();
    signedProof.message.proofData = Uint8Array.from([1, 2, 3]);
    signedProof.message.proofType = 1;
    signedProof.message.beaconBlockRoot = blockRoot;
    signedProof.validatorIndex = 3;
  });

  it("accepts a valid proof and hands the proof engine the public input", async () => {
    await expect(validateGossipExecutionProof(chain, signedProof)).resolves.toBeUndefined();

    expect(chain.bls.verifySignatureSets).toHaveBeenCalledOnce();
    expect(chain.proofEngine.verifyExecutionProof).toHaveBeenCalledOnce();
    const proof = chain.proofEngine.verifyExecutionProof.mock.calls[0][0];
    expect(proof.proofType).toBe(1);
    expect(proof.proofData).toBe(signedProof.message.proofData);
    expect(proof.publicInput.chainId).toBe(config.DEPOSIT_CHAIN_ID);
    expect(chain.seenExecutionProofs.isProverSeen(blockRootHex, 1, 3)).toBe(true);
  });

  it("ignores a proof for a block root and proof type that already has a verified proof", async () => {
    chain.seenExecutionProofs.addVerified(blockRootHex, blockSlot, signedProof.message);

    await expect(validateGossipExecutionProof(chain, signedProof)).rejects.toMatchObject({
      type: {code: ExecutionProofErrorCode.PROOF_ALREADY_KNOWN},
    });
    expect(chain.proofEngine.verifyExecutionProof).not.toHaveBeenCalled();
  });

  it("ignores a proof whose beacon block is unknown without caching it", async () => {
    chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(null);

    await expect(validateGossipExecutionProof(chain, signedProof)).rejects.toMatchObject({
      type: {code: ExecutionProofErrorCode.BLOCK_ROOT_UNKNOWN},
    });
    expect(chain.seenPayloadEnvelopeInputCache.getOrReload).not.toHaveBeenCalled();
    expect(chain.seenExecutionProofs.isProverSeen(blockRootHex, 1, 3)).toBe(false);
  });

  it("rejects an empty proof before any lookup", async () => {
    signedProof.message.proofData = new Uint8Array(0);

    await expect(validateGossipExecutionProof(chain, signedProof)).rejects.toMatchObject({
      type: {code: ExecutionProofErrorCode.EMPTY_PROOF_DATA},
    });
    expect(chain.forkChoice.getBlockHexDefaultStatus).not.toHaveBeenCalled();
    expect(chain.seenExecutionProofs.isProverSeen(blockRootHex, 1, 3)).toBe(false);
  });

  it.each([0, 4])("rejects unsupported proof type %i before any lookup", async (proofType) => {
    signedProof.message.proofType = proofType;

    await expect(validateGossipExecutionProof(chain, signedProof)).rejects.toMatchObject({
      type: {code: ExecutionProofErrorCode.UNSUPPORTED_PROOF_TYPE},
    });
    expect(chain.forkChoice.getBlockHexDefaultStatus).not.toHaveBeenCalled();
    expect(chain.seenExecutionProofs.isProverSeen(blockRootHex, proofType, 3)).toBe(false);
  });

  it("ignores a proof whose payload is not available yet", async () => {
    vi.mocked(chain.seenPayloadEnvelopeInputCache.getOrReload).mockResolvedValue(undefined);

    await expect(validateGossipExecutionProof(chain, signedProof)).rejects.toMatchObject({
      type: {code: ExecutionProofErrorCode.PAYLOAD_UNAVAILABLE},
    });
    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
    expect(chain.seenExecutionProofs.isProverSeen(blockRootHex, 1, 3)).toBe(false);
  });

  it("rejects a prover index outside the validator set", async () => {
    signedProof.validatorIndex = validatorCount;

    await expect(validateGossipExecutionProof(chain, signedProof)).rejects.toMatchObject({
      type: {code: ExecutionProofErrorCode.VALIDATOR_INDEX_OUT_OF_RANGE},
    });
    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
  });

  it("rejects an inactive prover", async () => {
    validator.activationEpoch = FAR_FUTURE_EPOCH;

    await expect(validateGossipExecutionProof(chain, signedProof)).rejects.toMatchObject({
      type: {code: ExecutionProofErrorCode.VALIDATOR_NOT_ACTIVE},
    });
    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated proof without charging the prover", async () => {
    chain.bls.verifySignatureSets.mockResolvedValueOnce(false);

    await expect(validateGossipExecutionProof(chain, signedProof)).rejects.toMatchObject({
      type: {code: ExecutionProofErrorCode.INVALID_SIGNATURE},
    });
    expect(chain.proofEngine.verifyExecutionProof).not.toHaveBeenCalled();
    expect(chain.seenExecutionProofs.isProverSeen(blockRootHex, 1, 3)).toBe(false);

    await expect(validateGossipExecutionProof(chain, signedProof)).resolves.toBeUndefined();
  });

  it("rejects an invalid proof and remembers the prover attempt", async () => {
    chain.proofEngine.verifyExecutionProof.mockResolvedValueOnce(false);

    await expect(validateGossipExecutionProof(chain, signedProof)).rejects.toMatchObject({
      type: {code: ExecutionProofErrorCode.INVALID_PROOF},
    });
    expect(chain.seenExecutionProofs.isProverSeen(blockRootHex, 1, 3)).toBe(true);

    signedProof.message.proofData = Uint8Array.from([4, 5, 6]);
    await expect(validateGossipExecutionProof(chain, signedProof)).rejects.toMatchObject({
      type: {code: ExecutionProofErrorCode.PROVER_ALREADY_SEEN},
    });
    expect(chain.proofEngine.verifyExecutionProof).toHaveBeenCalledOnce();
  });

  it("ignores an already processed proof re-gossiped by another prover", async () => {
    chain.proofEngine.verifyExecutionProof.mockResolvedValueOnce(false);
    await expect(validateGossipExecutionProof(chain, signedProof)).rejects.toMatchObject({
      type: {code: ExecutionProofErrorCode.INVALID_PROOF},
    });

    signedProof.validatorIndex = 4;
    await expect(validateGossipExecutionProof(chain, signedProof)).rejects.toMatchObject({
      type: {code: ExecutionProofErrorCode.PROOF_ALREADY_PROCESSED},
    });
    expect(chain.proofEngine.verifyExecutionProof).toHaveBeenCalledOnce();
  });
});
