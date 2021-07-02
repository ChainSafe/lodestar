import {
  allForks,
  CachedBeaconState,
  computeEpochAtSlot,
  computeSigningRoot,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBlockSummary, IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {DOMAIN_BEACON_ATTESTER} from "@chainsafe/lodestar-params";
import {phase0, Slot, ssz} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "../../../src/chain";
import {IStateRegenerator} from "../../../src/chain/regen";
import {ZERO_HASH} from "../../../src/constants";
import {
  generateTestCachedBeaconStateOnlyValidators,
  getSecretKeyFromIndexCached,
} from "@chainsafe/lodestar-beacon-state-transition/test/perf/util";
import {computeSubnetForSlot} from "@chainsafe/lodestar-beacon-state-transition/src/allForks";
import {SeenAttesters} from "../../../src/chain/seenCache";
import {BlsSingleThreadVerifier} from "../../../src/chain/bls";
import {signCached} from "../cache";
import {ClockStatic} from "../clock";
import {toSingleBit} from "../aggregationBits";

export type AttestationValidDataOpts = {
  currentSlot?: Slot;
  attSlot?: Slot;
  attIndex?: number;
  bitIndex?: number;
  targetRoot?: Uint8Array;
  beaconBlockRoot?: Uint8Array;
  state: ReturnType<typeof generateTestCachedBeaconStateOnlyValidators>;
};

/**
 * Generate a valid gossip Attestation object. Common logic for unit and perf tests
 */
export function getAttestationValidData(
  opts: AttestationValidDataOpts
): {chain: IBeaconChain; attestation: phase0.Attestation; subnet: number; validatorIndex: number} {
  const currentSlot = opts.currentSlot ?? 100;
  const attSlot = opts.attSlot ?? currentSlot;
  const attIndex = opts.attIndex ?? 1;
  const bitIndex = opts.bitIndex ?? 1;
  const targetRoot = opts.targetRoot ?? ZERO_HASH;
  const beaconBlockRoot = opts.beaconBlockRoot ?? ZERO_HASH;
  // Create cached state
  const state = opts.state;

  const clock = new ClockStatic(currentSlot);

  // Add block to forkChoice
  const headBlock: IBlockSummary = {
    slot: attSlot,
    blockRoot: beaconBlockRoot,
    parentRoot: ZERO_HASH,
    stateRoot: ZERO_HASH,
    targetRoot: targetRoot,
    justifiedEpoch: 0,
    finalizedEpoch: 0,
  };
  const forkChoice = ({
    getBlock: (root) => {
      if (!ssz.Root.equals(root, beaconBlockRoot)) return null;
      return headBlock;
    },
  } as Partial<IForkChoice>) as IForkChoice;

  const committeeIndices = state.getBeaconCommittee(attSlot, attIndex);
  const validatorIndex = committeeIndices[bitIndex];
  const aggregationBits = toSingleBit(committeeIndices.length, bitIndex);

  const attestationData: phase0.AttestationData = {
    slot: attSlot,
    index: attIndex,
    beaconBlockRoot: beaconBlockRoot,
    source: {
      epoch: 0,
      root: ZERO_HASH,
    },
    target: {
      epoch: computeEpochAtSlot(attSlot),
      root: targetRoot,
    },
  };

  const domain = state.config.getDomain(DOMAIN_BEACON_ATTESTER, attestationData.target.epoch);
  const signingRoot = computeSigningRoot(ssz.phase0.AttestationData, attestationData, domain);
  const sk = getSecretKeyFromIndexCached(validatorIndex);

  const attestation: phase0.Attestation = {
    aggregationBits,
    data: attestationData,
    signature: signCached(sk, signingRoot),
  };

  const subnet = computeSubnetForSlot(state, attSlot, attIndex);

  // Add state to regen
  const regen = ({
    getCheckpointState: async () => (state as unknown) as CachedBeaconState<allForks.BeaconState>,
  } as Partial<IStateRegenerator>) as IStateRegenerator;

  const chain = ({
    clock,
    forkChoice,
    regen,
    seenAttesters: new SeenAttesters(),
    bls: new BlsSingleThreadVerifier(),
  } as Partial<IBeaconChain>) as IBeaconChain;

  return {chain, attestation, subnet, validatorIndex};
}
