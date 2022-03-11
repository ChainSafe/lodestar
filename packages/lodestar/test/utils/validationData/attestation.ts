import {
  CachedBeaconStateAllForks,
  computeEpochAtSlot,
  computeSigningRoot,
  computeStartSlotAtEpoch,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IProtoBlock, IForkChoice, ExecutionStatus} from "@chainsafe/lodestar-fork-choice";
import {DOMAIN_BEACON_ATTESTER} from "@chainsafe/lodestar-params";
import {phase0, Slot, ssz} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "../../../src/chain";
import {IStateRegenerator} from "../../../src/chain/regen";
import {ZERO_HASH, ZERO_HASH_HEX} from "../../../src/constants";
import {
  generateTestCachedBeaconStateOnlyValidators,
  getSecretKeyFromIndexCached,
} from "@chainsafe/lodestar-beacon-state-transition/test/perf/util";
import {SeenAttesters} from "../../../src/chain/seenCache";
import {BlsSingleThreadVerifier} from "../../../src/chain/bls";
import {computeSubnetForSlot} from "../../../src/chain/validation";
import {signCached} from "../cache";
import {ClockStatic} from "../clock";
import {toSingleBit} from "../aggregationBits";
import {toHexString} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/default";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

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
  const attIndex = opts.attIndex ?? 0;
  const bitIndex = opts.bitIndex ?? 0;
  const targetRoot = opts.targetRoot ?? ZERO_HASH;
  const beaconBlockRoot = opts.beaconBlockRoot ?? ZERO_HASH;
  // Create cached state
  const state = opts.state;

  const clock = new ClockStatic(currentSlot);

  // Add block to forkChoice
  const headBlock: IProtoBlock = {
    slot: attSlot,
    blockRoot: toHexString(beaconBlockRoot),
    parentRoot: ZERO_HASH_HEX,
    stateRoot: ZERO_HASH_HEX,
    targetRoot: toHexString(targetRoot),

    justifiedEpoch: 0,
    justifiedRoot: ZERO_HASH_HEX,
    finalizedEpoch: 0,
    finalizedRoot: ZERO_HASH_HEX,

    ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
  };
  const forkChoice = ({
    getBlock: (root) => {
      if (!ssz.Root.equals(root, beaconBlockRoot)) return null;
      return headBlock;
    },
    getBlockHex: (rootHex) => {
      if (rootHex !== toHexString(beaconBlockRoot)) return null;
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

  const slot = computeStartSlotAtEpoch(attestationData.target.epoch);
  const domain = state.config.getDomain(DOMAIN_BEACON_ATTESTER, slot);
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
    getState: async () => (state as unknown) as CachedBeaconStateAllForks,
  } as Partial<IStateRegenerator>) as IStateRegenerator;

  const chain = ({
    clock,
    config: config as IBeaconConfig,
    forkChoice,
    regen,
    seenAttesters: new SeenAttesters(),
    bls: new BlsSingleThreadVerifier({metrics: null}),
    waitForBlockOfAttestation: () => Promise.resolve(false),
  } as Partial<IBeaconChain>) as IBeaconChain;

  return {chain, attestation, subnet, validatorIndex};
}
