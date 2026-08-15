import {describe, expect, it} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {
  FAR_FUTURE_EPOCH,
  ForkName,
  ForkSeq,
  MAX_COMMITTEES_PER_SLOT,
  MAX_EFFECTIVE_BALANCE,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {processAttestationsAltair} from "../../../src/block/processAttestationsAltair.js";
import {
  BeaconStateGloas,
  CachedBeaconStateGloas,
  createCachedBeaconState,
  createPubkeyCache,
} from "../../../src/index.js";
import {generateState} from "../../utils/state.js";
import {generateValidators} from "../../utils/validator.js";

const ATTESTATION_SLOT = 1;
const STATE_SLOT = 3;

function buildGloasState(): CachedBeaconStateGloas {
  const config = getConfig(ForkName.gloas);
  const validators = generateValidators(SLOTS_PER_EPOCH * 2, {
    activation: 0,
    exit: FAR_FUTURE_EPOCH,
    withdrawableEpoch: FAR_FUTURE_EPOCH,
    balance: MAX_EFFECTIVE_BALANCE,
  });
  const view = generateState({slot: STATE_SLOT, validators}, config) as BeaconStateGloas;

  for (let i = 0; i < validators.length; i++) {
    view.currentEpochParticipation.set(i, 0);
  }

  return createCachedBeaconState(
    view,
    {
      config: createBeaconConfig(config, view.genesisValidatorsRoot),
      pubkeyCache: createPubkeyCache(),
    },
    {skipSyncCommitteeCache: true}
  );
}

function buildAttestation(
  state: CachedBeaconStateGloas,
  targetRoot: Uint8Array,
  beaconBlockRoot: Uint8Array
): gloas.Attestation {
  const committee = state.epochCtx.getBeaconCommittee(ATTESTATION_SLOT, 0);

  return {
    aggregationBits: BitArray.fromSingleBit(committee.length, 0),
    data: {
      slot: ATTESTATION_SLOT,
      index: 0,
      beaconBlockRoot,
      source: ssz.phase0.Checkpoint.toValueFromViewDU(state.currentJustifiedCheckpoint),
      target: {epoch: 0, root: targetRoot},
    },
    signature: new Uint8Array(96),
    committeeBits: BitArray.fromSingleBit(MAX_COMMITTEES_PER_SLOT, 0),
  };
}

describe("processAttestationsAltair", () => {
  it("credits builder payment weight once under target equivocation", () => {
    const state = buildGloasState();
    const sameSlotRoot = new Uint8Array(32).fill(0x22);
    state.blockRoots.set(ATTESTATION_SLOT, sameSlotRoot);

    const committee = state.epochCtx.getBeaconCommittee(ATTESTATION_SLOT, 0);
    const attesterIndex = committee[0];
    const correctTargetRoot = state.blockRoots.get(0);
    const wrongTargetRoot = new Uint8Array(32).fill(0x11);
    const paymentIndex = SLOTS_PER_EPOCH + ATTESTATION_SLOT;
    state.builderPendingPayments.set(
      paymentIndex,
      ssz.gloas.BuilderPendingPayment.toViewDU({
        weight: 0,
        proposerIndex: 0,
        withdrawal: {
          feeRecipient: new Uint8Array(20),
          amount: 1,
          builderIndex: 0,
        },
      })
    );

    const wrongTargetAttestation = buildAttestation(state, wrongTargetRoot, sameSlotRoot);
    const correctTargetAttestation = buildAttestation(state, correctTargetRoot, sameSlotRoot);

    processAttestationsAltair(
      ForkSeq.gloas,
      state,
      [wrongTargetAttestation, correctTargetAttestation],
      ATTESTATION_SLOT,
      false
    );

    expect(state.builderPendingPayments.get(paymentIndex).weight).toBe(
      state.validators.getReadonly(attesterIndex).effectiveBalance
    );
  });
});
