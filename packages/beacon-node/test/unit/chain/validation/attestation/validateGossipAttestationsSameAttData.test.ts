import bls from "@chainsafe/bls";
import type {PublicKey, SecretKey} from "@chainsafe/bls/types";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {SignatureSetType} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {BlsSingleThreadVerifier} from "../../../../../src/chain/bls/singleThread.js";
import {AttestationError, AttestationErrorCode, GossipAction} from "../../../../../src/chain/errors/index.js";
import {IBeaconChain} from "../../../../../src/chain/index.js";
import {SeenAttesters} from "../../../../../src/chain/seenCache/seenAttesters.js";
import {Step0Result, validateGossipAttestationsSameAttData} from "../../../../../src/chain/validation/index.js";

describe("validateGossipAttestationsSameAttData", () => {
  // phase0Result specifies whether the attestation is valid in phase0
  // phase1Result specifies signature verification
  const testCases: {phase0Result: boolean[]; phase1Result: boolean[]; seenAttesters: number[]}[] = [
    {
      phase0Result: [true, true, true, true, true],
      phase1Result: [true, true, true, true, true],
      seenAttesters: [0, 1, 2, 3, 4],
    },
    {
      phase0Result: [false, true, true, true, true],
      phase1Result: [true, false, true, true, true],
      seenAttesters: [2, 3, 4],
    },
    {
      phase0Result: [false, false, true, true, true],
      phase1Result: [true, false, false, true, true],
      seenAttesters: [3, 4],
    },
    {
      phase0Result: [false, false, true, true, true],
      phase1Result: [true, false, false, true, false],
      seenAttesters: [3],
    },
    {
      phase0Result: [false, false, true, true, true],
      phase1Result: [true, true, false, false, false],
      seenAttesters: [],
    },
  ];

  type Keypair = {publicKey: PublicKey; secretKey: SecretKey};
  const keypairs = new Map<number, Keypair>();
  function getKeypair(i: number): Keypair {
    let keypair = keypairs.get(i);
    if (!keypair) {
      const bytes = new Uint8Array(32);
      const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      dataView.setUint32(0, i + 1, true);
      const secretKey = bls.SecretKey.fromBytes(bytes);
      const publicKey = secretKey.toPublicKey();
      keypair = {secretKey, publicKey};
      keypairs.set(i, keypair);
    }
    return keypair;
  }

  let chain: IBeaconChain;
  const signingRoot = Buffer.alloc(32, 1);

  beforeEach(() => {
    chain = {
      bls: new BlsSingleThreadVerifier({metrics: null}),
      seenAttesters: new SeenAttesters(),
      opts: {
        minSameMessageSignatureSetsToBatch: 2,
      } as IBeaconChain["opts"],
    } as Partial<IBeaconChain> as IBeaconChain;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  for (const [testCaseIndex, testCase] of testCases.entries()) {
    const {phase0Result, phase1Result, seenAttesters} = testCase;
    it(`test case ${testCaseIndex}`, async () => {
      const phase0Results: Promise<Step0Result>[] = [];
      for (const [i, isValid] of phase0Result.entries()) {
        const signatureSet = {
          type: SignatureSetType.single,
          pubkey: getKeypair(i).publicKey,
          signingRoot,
          signature: getKeypair(i).secretKey.sign(signingRoot).toBytes(),
        };
        if (isValid) {
          if (!phase1Result[i]) {
            // invalid signature
            signatureSet.signature = getKeypair(2023).secretKey.sign(signingRoot).toBytes();
          }
          phase0Results.push(
            Promise.resolve({
              attestation: ssz.phase0.Attestation.defaultValue(),
              signatureSet,
              validatorIndex: i,
            } as Partial<Step0Result> as Step0Result)
          );
        } else {
          phase0Results.push(
            Promise.reject(
              new AttestationError(GossipAction.REJECT, {
                code: AttestationErrorCode.BAD_TARGET_EPOCH,
              })
            )
          );
        }
      }

      let callIndex = 0;
      const phase0ValidationFn = (): Promise<Step0Result> => {
        const result = phase0Results[callIndex];
        callIndex++;
        return result;
      };
      await validateGossipAttestationsSameAttData(ForkName.phase0, chain, new Array(5).fill({}), 0, phase0ValidationFn);
      for (let validatorIndex = 0; validatorIndex < phase0Result.length; validatorIndex++) {
        if (seenAttesters.includes(validatorIndex)) {
          expect(chain.seenAttesters.isKnown(0, validatorIndex)).toBe(true);
        } else {
          expect(chain.seenAttesters.isKnown(0, validatorIndex)).toBe(false);
        }
      }
    }); // end test case
  }
});
