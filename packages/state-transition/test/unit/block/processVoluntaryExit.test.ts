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

  it("rejects a builder exit before its exit epoch", () => {
    expect(
      getVoluntaryExitValidity(
        ForkSeq.gloas,
        state,
        {
          ...signedVoluntaryExit,
          message: {
            ...signedVoluntaryExit.message,
            epoch: state.epochCtx.epoch + 1,
          },
        },
        false
      )
    ).toBe(VoluntaryExitValidity.earlyEpoch);
  });

  it("rejects a builder exit with pending withdrawals", () => {
    const stateWithPendingWithdrawals = {
      ...state,
      builderPendingWithdrawals: {
        length: 1,
        getReadonly: () => ({builderIndex: 0, amount: 1000}),
      },
    } as unknown as CachedBeaconStateAllForks;

    expect(getVoluntaryExitValidity(ForkSeq.gloas, stateWithPendingWithdrawals, signedVoluntaryExit, false)).toBe(
      VoluntaryExitValidity.pendingWithdrawals
    );
  });

  it("rejects exit for non-existent builder", () => {
    const stateNoBuilders = {
      ...state,
      builders: {
        length: 0,
        getReadonly: () => {
          throw Error("Should not be called");
        },
      },
    } as unknown as CachedBeaconStateAllForks;

    // Non-existent builder has undefined withdrawableEpoch which !== FAR_FUTURE_EPOCH, treated as already exited
    expect(getVoluntaryExitValidity(ForkSeq.gloas, stateNoBuilders, signedVoluntaryExit, false)).toBe(
      VoluntaryExitValidity.alreadyExited
    );
  });

  it("rejects exit for already exited builder", () => {
    const stateExitedBuilder = {
      ...state,
      builders: {
        length: 1,
        getReadonly: () => ({
          pubkey: builderPubkey,
          version: 1,
          executionAddress: Buffer.alloc(20, 1),
          balance: 32e9,
          depositEpoch: 0,
          withdrawableEpoch: 100,
        }),
      },
    } as unknown as CachedBeaconStateAllForks;

    expect(getVoluntaryExitValidity(ForkSeq.gloas, stateExitedBuilder, signedVoluntaryExit, false)).toBe(
      VoluntaryExitValidity.alreadyExited
    );
  });

  it("accepts a validator exit at gloas fork", () => {
    const validatorIndex = 0;
    // Use a high enough epoch so SHARD_COMMITTEE_PERIOD (256) is satisfied
    const highEpoch = 300;
    const highSlot = highEpoch * SLOTS_PER_EPOCH;
    const stateWithValidator = {
      ...state,
      slot: highSlot,
      epochCtx: {...state.epochCtx, epoch: highEpoch},
      builders: {
        length: 0,
        getReadonly: () => {
          throw Error("unused");
        },
      },
      validators: {
        length: 1,
        getReadonly: () => ({
          activationEpoch: 0,
          exitEpoch: FAR_FUTURE_EPOCH,
          withdrawableEpoch: FAR_FUTURE_EPOCH,
          slashed: false,
        }),
      },
      pendingPartialWithdrawals: {getAllReadonly: () => []},
    } as unknown as CachedBeaconStateAllForks;

    const validatorExit: phase0.SignedVoluntaryExit = {
      message: {epoch: 0, validatorIndex},
      signature: Buffer.alloc(96, 0),
    };

    expect(getVoluntaryExitValidity(ForkSeq.gloas, stateWithValidator, validatorExit, false)).toBe(
      VoluntaryExitValidity.valid
    );
  });
});
