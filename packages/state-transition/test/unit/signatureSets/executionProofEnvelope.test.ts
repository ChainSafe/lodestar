import {describe, expect, it} from "vitest";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {DOMAIN_EXECUTION_PROOF} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {getExecutionProofEnvelopeSignatureSet} from "../../../src/signatureSets/executionProofEnvelope.js";
import {IBeaconStateView} from "../../../src/stateView/interface.js";
import {SignatureSetType, computeSigningRoot} from "../../../src/util/index.js";

describe("getExecutionProofEnvelopeSignatureSet", () => {
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
    Buffer.alloc(32, 1)
  );

  it("signs the envelope under DOMAIN_EXECUTION_PROOF at the state slot for the prover index", () => {
    const signedProof = ssz.eip8025.SignedExecutionProofEnvelope.defaultValue();
    signedProof.message.proofData = Uint8Array.from([1, 2, 3]);
    signedProof.message.proofType = 2;
    signedProof.validatorIndex = 5;
    const state = {slot: 42} as IBeaconStateView;

    expect(getExecutionProofEnvelopeSignatureSet(config, state, signedProof)).toEqual({
      type: SignatureSetType.indexed,
      index: 5,
      signingRoot: computeSigningRoot(
        ssz.eip8025.ExecutionProofEnvelope,
        signedProof.message,
        config.getDomain(42, DOMAIN_EXECUTION_PROOF)
      ),
      signature: signedProof.signature,
    });
  });
});
