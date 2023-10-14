import {BitArray, toHexString} from "@chainsafe/ssz";
import {
  computeEpochAtSlot,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  getShufflingDecisionBlock,
} from "@lodestar/state-transition";
import {ProtoBlock, IForkChoice, ExecutionStatus} from "@lodestar/fork-choice";
import {DOMAIN_BEACON_ATTESTER} from "@lodestar/params";
import {phase0, Slot, ssz} from "@lodestar/types";
import {
  generateTestCachedBeaconStateOnlyValidators,
  getSecretKeyFromIndexCached,
  // eslint-disable-next-line import/no-relative-packages
} from "../../../../state-transition/test/perf/util.js";
import {IBeaconChain} from "../../../src/chain/index.js";
import {IStateRegenerator} from "../../../src/chain/regen/index.js";
import {ZERO_HASH, ZERO_HASH_HEX} from "../../../src/constants/index.js";
import {SeenAttesters} from "../../../src/chain/seenCache/index.js";
import {BlsMultiThreadWorkerPool, BlsSingleThreadVerifier} from "../../../src/chain/bls/index.js";
import {signCached} from "../cache.js";
import {ClockStatic} from "../clock.js";
import {SeenAggregatedAttestations} from "../../../src/chain/seenCache/seenAggregateAndProof.js";
import {SeenAttestationDatas} from "../../../src/chain/seenCache/seenAttestationData.js";
import {defaultChainOptions} from "../../../src/chain/options.js";
import {testLogger} from "../logger.js";
import {ShufflingCache} from "../../../src/chain/shufflingCache.js";

export type AttestationValidDataOpts = {
  currentSlot?: Slot;
  attSlot?: Slot;
  attIndex?: number;
  bitIndex?: number;
  targetRoot?: Uint8Array;
  beaconBlockRoot?: Uint8Array;
  blsVerifyAllMainThread?: boolean;
  state: ReturnType<typeof generateTestCachedBeaconStateOnlyValidators>;
};

/**
 * Generate a valid gossip Attestation object. Common logic for unit and perf tests
 */
export function getAttestationValidData(opts: AttestationValidDataOpts): {
  chain: IBeaconChain;
  attestation: phase0.Attestation;
  subnet: number;
  validatorIndex: number;
} {
  const currentSlot = opts.currentSlot ?? 100;
  const attSlot = opts.attSlot ?? currentSlot;
  const attIndex = opts.attIndex ?? 0;
  const bitIndex = opts.bitIndex ?? 0;
  const targetRoot = opts.targetRoot ?? ZERO_HASH;
  const beaconBlockRoot = opts.beaconBlockRoot ?? ZERO_HASH;
  const blsVerifyAllMainThread = opts.blsVerifyAllMainThread ?? true;
  // Create cached state
  const state = opts.state;

  const clock = new ClockStatic(currentSlot);

  // Add block to forkChoice
  const headBlock: ProtoBlock = {
    slot: attSlot,
    blockRoot: toHexString(beaconBlockRoot),
    parentRoot: ZERO_HASH_HEX,
    stateRoot: ZERO_HASH_HEX,
    targetRoot: toHexString(targetRoot),

    justifiedEpoch: 0,
    justifiedRoot: ZERO_HASH_HEX,
    finalizedEpoch: 0,
    finalizedRoot: ZERO_HASH_HEX,
    unrealizedJustifiedEpoch: 0,
    unrealizedJustifiedRoot: ZERO_HASH_HEX,
    unrealizedFinalizedEpoch: 0,
    unrealizedFinalizedRoot: ZERO_HASH_HEX,

    ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
  };

  const shufflingCache = new ShufflingCache();
  shufflingCache.processState(state, state.epochCtx.currentShuffling.epoch);
  shufflingCache.processState(state, state.epochCtx.nextShuffling.epoch);
  const dependentRoot = getShufflingDecisionBlock(state, state.epochCtx.currentShuffling.epoch);

  const forkChoice = {
    getBlock: (root) => {
      if (!ssz.Root.equals(root, beaconBlockRoot)) return null;
      return headBlock;
    },
    getBlockHex: (rootHex) => {
      if (rootHex !== toHexString(beaconBlockRoot)) return null;
      return headBlock;
    },
    getDependentRoot: () => dependentRoot,
  } as Partial<IForkChoice> as IForkChoice;

  const committeeIndices = state.epochCtx.getBeaconCommittee(attSlot, attIndex);
  const validatorIndex = committeeIndices[bitIndex];

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
  const domain = state.config.getDomain(state.slot, DOMAIN_BEACON_ATTESTER, slot);
  const signingRoot = computeSigningRoot(ssz.phase0.AttestationData, attestationData, domain);
  const sk = getSecretKeyFromIndexCached(validatorIndex);

  const attestation: phase0.Attestation = {
    aggregationBits: BitArray.fromSingleBit(committeeIndices.length, bitIndex),
    data: attestationData,
    signature: signCached(sk, signingRoot),
  };

  const subnet = state.epochCtx.computeSubnetForSlot(attSlot, attIndex);

  // Add state to regen
  const regen = {
    getState: async () => state,
    // TODO: remove this once we have a better way to get state
    getStateSync: () => state,
  } as Partial<IStateRegenerator> as IStateRegenerator;

  const chain = {
    clock,
    config: state.config,
    forkChoice,
    regen,
    seenAttesters: new SeenAttesters(),
    seenAggregatedAttestations: new SeenAggregatedAttestations(null),
    seenAttestationDatas: new SeenAttestationDatas(null, 0, 0),
    bls: blsVerifyAllMainThread
      ? new BlsSingleThreadVerifier({metrics: null})
      : new BlsMultiThreadWorkerPool({}, {logger: testLogger(), metrics: null}),
    waitForBlock: () => Promise.resolve(false),
    index2pubkey: state.epochCtx.index2pubkey,
    shufflingCache,
    opts: defaultChainOptions,
  } as Partial<IBeaconChain> as IBeaconChain;

  return {chain, attestation, subnet, validatorIndex};
}
