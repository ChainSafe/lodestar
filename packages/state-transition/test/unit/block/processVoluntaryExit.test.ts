import {beforeAll, describe, expect, it} from "vitest";
import {SecretKey} from "@chainsafe/blst";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as chainConfig} from "@lodestar/config/default";
import {BUILDER_INDEX_FLAG, FAR_FUTURE_EPOCH, ForkSeq, SLOTS_PER_EPOCH} from "@lodestar/params";
import {phase0, ssz} from "@lodestar/types";
import {VoluntaryExitValidity, getVoluntaryExitValidity} from "../../../src/block/processVoluntaryExit.js";
import {createPubkeyCache} from "../../../src/cache/pubkeyCache.js";
import {getVoluntaryExitSignatureSet} from "../../../src/signatureSets/voluntaryExits.js";
import {CachedBeaconStateAllForks} from "../../../src/types.js";
import {computeEpochAtSlot, computeSigningRoot} from "../../../src/util/index.js";

describe("processVoluntaryExit Gloas builder helpers", () => {
  let state: CachedBeaconStateAllForks;
  let signedVoluntaryExit: phase0.SignedVoluntaryExit;
  let builderPubkey: Uint8Array;

  beforeAll(() => {
    const sk = SecretKey.fromKeygen(Buffer.alloc(32, 1));
    builderPubkey = sk.toPublicKey().toBytes();

    const forkConfig = createChainForkConfig({
      ...chainConfig,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 1,
      FULU_FORK_EPOCH: 2,
      GLOAS_FORK_EPOCH: 3,
    });
    const config = createBeaconConfig(forkConfig, ssz.Root.defaultValue());
    const slot = 3 * SLOTS_PER_EPOCH;

    state = {
      slot,
      config,
      epochCtx: {
        epoch: computeEpochAtSlot(slot),
        pubkeyCache: createPubkeyCache(),
      },
      finalizedCheckpoint: {epoch: 4},
      builders: {
        length: 1,
        getReadonly: (index: number) => {
          if (index !== 0) {
            throw Error(`Unknown builder index ${index}`);
          }
          return {
            pubkey: builderPubkey,
            version: 1,
            executionAddress: Buffer.alloc(20, 1),
            balance: 32e9,
            depositEpoch: 0,
            withdrawableEpoch: FAR_FUTURE_EPOCH,
          };
        },
      },
      builderPendingWithdrawals: {
        length: 0,
        getReadonly: () => {
          throw Error("Unexpected builder pending withdrawal lookup");
        },
      },
      builderPendingPayments: {
        length: 0,
        getReadonly: () => {
          throw Error("Unexpected builder pending payment lookup");
        },
      },
      validators: {
        length: 0,
        getReadonly: () => {
          throw Error("Unexpected validator lookup for builder exit");
        },
      },
    } as unknown as CachedBeaconStateAllForks;

    const voluntaryExit = {
      epoch: 0,
      validatorIndex: BUILDER_INDEX_FLAG,
    };
    const signingRoot = computeSigningRoot(
      ssz.phase0.VoluntaryExit,
      voluntaryExit,
      config.getDomainForVoluntaryExit(state.slot, 0)
    );
    signedVoluntaryExit = {
      message: voluntaryExit,
      signature: sk.sign(signingRoot).toBytes(),
    };
  });

  it("accepts an active builder exit and uses the builder pubkey", () => {
    expect(getVoluntaryExitValidity(ForkSeq.gloas, state, signedVoluntaryExit, false)).toBe(
      VoluntaryExitValidity.valid
    );

    const signatureSet = getVoluntaryExitSignatureSet(state.config, state, signedVoluntaryExit);
    expect(signatureSet.type).toBe("single");
    if (signatureSet.type === "single") {
      expect(signatureSet.pubkey.toBytes()).toEqual(builderPubkey);
    }
  });

  it("rejects a builder exit with an invalid signature", () => {
    const wrongSignature = SecretKey.fromKeygen(Buffer.alloc(32, 2)).sign(Buffer.alloc(32, 3)).toBytes();

    expect(
      getVoluntaryExitValidity(
        ForkSeq.gloas,
        state,
        {
          ...signedVoluntaryExit,
          signature: wrongSignature,
        },
        true
      )
    ).toBe(VoluntaryExitValidity.invalidSignature);
  });
});
