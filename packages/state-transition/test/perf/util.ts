import {config} from "@lodestar/config/default";
import {allForks, phase0, ssz, Slot, altair} from "@lodestar/types";
import {CoordType, PublicKey, SecretKey} from "@chainsafe/bls/types";
import bls from "@chainsafe/bls";
import {BitArray, fromHexString} from "@chainsafe/ssz";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {
  EPOCHS_PER_ETH1_VOTING_PERIOD,
  EPOCHS_PER_HISTORICAL_VECTOR,
  MAX_ATTESTATIONS,
  MAX_EFFECTIVE_BALANCE,
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT,
} from "@lodestar/params";
import {
  interopSecretKey,
  computeEpochAtSlot,
  getActiveValidatorIndices,
  PubkeyIndexMap,
  newFilledArray,
  createCachedBeaconState,
  computeCommitteeCount,
} from "../../src/index.js";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStatePhase0,
  CachedBeaconStateAltair,
  BeaconStatePhase0,
  BeaconStateAltair,
} from "../../src/types.js";
import {profilerLogger} from "../utils/logger.js";
import {interopPubkeysCached} from "../utils/interop.js";
import {getNextSyncCommittee} from "../../src/util/syncCommittee.js";
import {getEffectiveBalanceIncrements} from "../../src/cache/effectiveBalanceIncrements.js";
import {processSlots} from "../../src/index.js";

let phase0State: BeaconStatePhase0 | null = null;
let phase0CachedState23637: CachedBeaconStatePhase0 | null = null;
let phase0CachedState23638: CachedBeaconStatePhase0 | null = null;
let phase0SignedBlock: phase0.SignedBeaconBlock | null = null;
let altairState: BeaconStateAltair | null = null;
let altairCachedState23637: CachedBeaconStateAltair | null = null;
let altairCachedState23638: CachedBeaconStateAltair | null = null;
const logger = profilerLogger();

/**
 * Number of validators in prater is 210000 as of May 2021
 */
export const numValidators = 250000;
export const keypairsMod = 100;

/**
 * As of Jul 07 2021, the performance state has
 * out.prevEpochUnslashedStake.targetStake 7750000000000000n
 * out.currEpochUnslashedTargetStake 7750000000000000n
 * This prefix represent the total stake in Peta Wei
 */
export const perfStateId = `${numValidators} vs - 7PWei`;

/** Cache interop secret keys */
const secretKeyByModIndex = new Map<number, SecretKey>();
const epoch = 23638;
export const perfStateEpoch = epoch;

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function getPubkeys(vc = numValidators) {
  const pubkeysMod = interopPubkeysCached(keypairsMod);
  const pubkeysModObj = pubkeysMod.map((pk) => bls.PublicKey.fromBytes(pk, CoordType.jacobian));
  const pubkeys = Array.from({length: vc}, (_, i) => pubkeysMod[i % keypairsMod]);
  return {pubkeysMod, pubkeysModObj, pubkeys};
}

/** Get secret key of a validatorIndex, if the pubkeys are generated with `getPubkeys()` */
export function getSecretKeyFromIndex(validatorIndex: number): SecretKey {
  return interopSecretKey(validatorIndex % keypairsMod);
}

/** Get secret key of a validatorIndex, if the pubkeys are generated with `getPubkeys()` */
export function getSecretKeyFromIndexCached(validatorIndex: number): SecretKey {
  const keyIndex = validatorIndex % keypairsMod;
  let sk = secretKeyByModIndex.get(keyIndex);
  if (!sk) {
    sk = interopSecretKey(keyIndex);
    secretKeyByModIndex.set(keyIndex, sk);
  }
  return sk;
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function getPubkeyCaches({pubkeysMod, pubkeysModObj}: ReturnType<typeof getPubkeys>) {
  // Manually sync pubkeys to prevent doing BLS opts 110_000 times
  const pubkey2index = new PubkeyIndexMap();
  const index2pubkey = [] as PublicKey[];
  for (let i = 0; i < numValidators; i++) {
    const pubkey = pubkeysMod[i % keypairsMod];
    const pubkeyObj = pubkeysModObj[i % keypairsMod];
    pubkey2index.set(pubkey, i);
    index2pubkey.push(pubkeyObj);
  }

  // Since most pubkeys are equal the size of pubkey2index is not numValidators.
  // Fill with junk up to numValidators
  for (let i = pubkey2index.size; i < numValidators; i++) {
    const buf = Buffer.alloc(48, 0);
    buf.writeInt32LE(i);
    pubkey2index.set(buf, i);
  }

  return {pubkey2index, index2pubkey};
}

export function generatePerfTestCachedStatePhase0(opts?: {goBackOneSlot: boolean}): CachedBeaconStatePhase0 {
  // Generate only some publicKeys
  const {pubkeys, pubkeysMod, pubkeysModObj} = getPubkeys();
  const {pubkey2index, index2pubkey} = getPubkeyCaches({pubkeys, pubkeysMod, pubkeysModObj});

  if (!phase0State) {
    const state = buildPerformanceStatePhase0();

    // no justificationBits
    phase0State = ssz.phase0.BeaconState.toViewDU(state);
    logger.verbose("Loaded phase0 state", {
      slot: state.slot,
      numValidators: state.validators.length,
    });

    // cache roots
    phase0State.hashTreeRoot();
  }

  if (!phase0CachedState23637) {
    const state = phase0State.clone();
    state.slot -= 1;
    phase0CachedState23637 = createCachedBeaconState(state, {
      config: createBeaconConfig(config, state.genesisValidatorsRoot),
      pubkey2index,
      index2pubkey,
    });

    const currentEpoch = computeEpochAtSlot(state.slot - 1);
    const previousEpoch = currentEpoch - 1;

    // previous epoch attestations
    const numPrevAttestations = SLOTS_PER_EPOCH * MAX_ATTESTATIONS;
    const activeValidatorCount = pubkeys.length;
    const committeesPerSlot = computeCommitteeCount(activeValidatorCount);
    for (let i = 0; i < numPrevAttestations; i++) {
      const slotInEpoch = i % SLOTS_PER_EPOCH;
      const slot = previousEpoch * SLOTS_PER_EPOCH + slotInEpoch;
      const index = i % committeesPerSlot;
      const shuffling = phase0CachedState23637.epochCtx.getShufflingAtEpoch(previousEpoch);
      const committee = shuffling.committees[slotInEpoch][index];
      phase0CachedState23637.previousEpochAttestations.push(
        ssz.phase0.PendingAttestation.toViewDU({
          aggregationBits: BitArray.fromBoolArray(Array.from({length: committee.length}, () => true)),
          data: {
            beaconBlockRoot: phase0CachedState23637.blockRoots.get(slotInEpoch % SLOTS_PER_HISTORICAL_ROOT),
            index,
            slot,
            source: state.previousJustifiedCheckpoint,
            target: state.currentJustifiedCheckpoint,
          },
          inclusionDelay: 1,
          proposerIndex: i,
        })
      );
    }

    // current epoch attestations
    const numCurAttestations = (SLOTS_PER_EPOCH - 1) * MAX_ATTESTATIONS;
    for (let i = 0; i < numCurAttestations; i++) {
      const slotInEpoch = i % SLOTS_PER_EPOCH;
      const slot = currentEpoch * SLOTS_PER_EPOCH + slotInEpoch;
      const index = i % committeesPerSlot;
      const shuffling = phase0CachedState23637.epochCtx.getShufflingAtEpoch(previousEpoch);
      const committee = shuffling.committees[slotInEpoch][index];

      phase0CachedState23637.currentEpochAttestations.push(
        ssz.phase0.PendingAttestation.toViewDU({
          aggregationBits: BitArray.fromBoolArray(Array.from({length: committee.length}, () => true)),
          data: {
            beaconBlockRoot: phase0CachedState23637.blockRoots.get(slotInEpoch % SLOTS_PER_HISTORICAL_ROOT),
            index,
            slot,
            source: state.currentJustifiedCheckpoint,
            target: {
              epoch: currentEpoch,
              root: phase0CachedState23637.blockRoots.get((currentEpoch * SLOTS_PER_EPOCH) % SLOTS_PER_HISTORICAL_ROOT),
            },
          },
          inclusionDelay: 1,
          proposerIndex: i,
        })
      );
    }
  }
  if (!phase0CachedState23638) {
    phase0CachedState23638 = processSlots(
      phase0CachedState23637,
      phase0CachedState23637.slot + 1
    ) as CachedBeaconStatePhase0;
    phase0CachedState23638.slot += 1;
  }
  const resultingState = opts && opts.goBackOneSlot ? phase0CachedState23637 : phase0CachedState23638;

  return resultingState.clone();
}

export function cachedStateAltairPopulateCaches(state: CachedBeaconStateAltair): void {
  // Populate caches
  state.blockRoots.getAllReadonly();
  state.eth1DataVotes.getAllReadonly();
  state.validators.getAllReadonly();
  state.balances.getAll();
  state.previousEpochParticipation.getAll();
  state.currentEpochParticipation.getAll();
  state.inactivityScores.getAll();
}

export function generatePerfTestCachedStateAltair(opts?: {goBackOneSlot: boolean}): CachedBeaconStateAltair {
  const {pubkeys, pubkeysMod, pubkeysModObj} = getPubkeys();
  const {pubkey2index, index2pubkey} = getPubkeyCaches({pubkeys, pubkeysMod, pubkeysModObj});

  // eslint-disable-next-line @typescript-eslint/naming-convention
  const altairConfig = createChainForkConfig({ALTAIR_FORK_EPOCH: 0});

  const origState = generatePerformanceStateAltair(pubkeys);

  if (!altairCachedState23637) {
    const state = origState.clone();
    state.slot -= 1;
    altairCachedState23637 = createCachedBeaconState(state, {
      config: createBeaconConfig(altairConfig, state.genesisValidatorsRoot),
      pubkey2index,
      index2pubkey,
    });
  }
  if (!altairCachedState23638) {
    altairCachedState23638 = processSlots(
      altairCachedState23637,
      altairCachedState23637.slot + 1
    ) as CachedBeaconStateAltair;
    altairCachedState23638.slot += 1;
  }
  const resultingState = opts && opts.goBackOneSlot ? altairCachedState23637 : altairCachedState23638;

  return resultingState.clone();
}

/**
 * This is generated from Medalla state 756416
 */
export function generatePerformanceStateAltair(pubkeysArg?: Uint8Array[]): BeaconStateAltair {
  if (!altairState) {
    const pubkeys = pubkeysArg || getPubkeys().pubkeys;
    const statePhase0 = buildPerformanceStatePhase0();
    const state = (statePhase0 as allForks.BeaconState) as altair.BeaconState;

    state.previousEpochParticipation = newFilledArray(pubkeys.length, 0b111);
    state.currentEpochParticipation = state.previousEpochParticipation;
    state.inactivityScores = Array.from({length: pubkeys.length}, (_, i) => i % 2);

    // Placeholder syncCommittees
    state.currentSyncCommittee = ssz.altair.SyncCommittee.defaultValue();
    state.nextSyncCommittee = state.currentSyncCommittee;

    // Now the state is fully populated to convert to ViewDU
    altairState = ssz.altair.BeaconState.toViewDU(state);

    // Now set correct syncCommittees
    const epoch = computeEpochAtSlot(state.slot);
    const activeValidatorIndices = getActiveValidatorIndices(altairState, epoch);

    const effectiveBalanceIncrements = getEffectiveBalanceIncrements(altairState);
    const {syncCommittee} = getNextSyncCommittee(altairState, activeValidatorIndices, effectiveBalanceIncrements);
    state.currentSyncCommittee = syncCommittee;
    state.nextSyncCommittee = syncCommittee;

    altairState = ssz.altair.BeaconState.toViewDU(state);
    logger.verbose("Loaded phase0 state", {
      slot: altairState.slot,
      numValidators: altairState.validators.length,
    });
    // cache roots
    altairState.hashTreeRoot();
  }
  return altairState.clone();
}

/**
 * This is generated from Medalla block 756417
 */
export function generatePerformanceBlockPhase0(): phase0.SignedBeaconBlock {
  if (!phase0SignedBlock) {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    const parentState = generatePerfTestCachedStatePhase0();
    block.message.slot = parentState.slot;
    block.message.proposerIndex = parentState.epochCtx.getBeaconProposer(parentState.slot);
    block.message.parentRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(parentState.latestBlockHeader);
    block.message.stateRoot = fromHexString("0x6c86ca3c4c6688cf189421b8a68bf2dbc91521609965e6f4e207d44347061fee");
    block.message.body.randaoReveal = fromHexString(
      "0x8a5d2673c48f22f6ed19462efec35645db490df29eed2f56321dbe4a89b2463b0c902095a7ab74a2dc5b7f67edb1a19507ea3d4361d5af9cb0a524945c91638dfd6568841486813a2c45142659d6d9403f5081febb123a7931edbc248b9d0025"
    );
    // eth1Data, graffiti, attestations
    phase0SignedBlock = block;
    logger.verbose("Loaded block", {slot: phase0SignedBlock.message.slot});
  }

  return phase0SignedBlock;
}

function buildPerformanceStatePhase0(pubkeysArg?: Uint8Array[]): phase0.BeaconState {
  const slot = epoch * SLOTS_PER_EPOCH;
  const pubkeys = pubkeysArg || getPubkeys().pubkeys;
  const currentEpoch = computeEpochAtSlot(slot - 1);

  return {
    // Misc
    genesisTime: 1596546008,
    genesisValidatorsRoot: fromHexString("0x04700007fabc8282644aed6d1c7c9e21d38a03a0c4ba193f3afe428824b3a673"),
    slot: epoch * SLOTS_PER_EPOCH,
    fork: {
      currentVersion: fromHexString("0x00000001"),
      previousVersion: fromHexString("0x00000001"),
      epoch: 0,
    },
    // History
    latestBlockHeader: {
      slot: slot - 1,
      proposerIndex: 80882,
      parentRoot: fromHexString("0x5b83c3078e474b86af60043eda82a34c3c2e5ebf83146b14d9d909aea4163ef2"),
      stateRoot: fromHexString("0x2761ae355e8a53c11e0e37d5e417f8984db0c53fa83f1bc65f89c6af35a196a7"),
      bodyRoot: fromHexString("0x249a1962eef90e122fa2447040bfac102798b1dba9c73e5593bc5aa32eb92bfd"),
    },
    blockRoots: Array.from({length: SLOTS_PER_HISTORICAL_ROOT}, (_, i) => Buffer.alloc(32, i)),
    stateRoots: Array.from({length: SLOTS_PER_HISTORICAL_ROOT}, (_, i) => Buffer.alloc(32, i)),
    historicalRoots: [],
    // Eth1
    eth1Data: {
      depositCount: pubkeys.length,
      depositRoot: fromHexString("0xcb1f89a924cfd31224823db5a41b1643f10faa7aedf231f1e28887f6ee98c047"),
      blockHash: fromHexString("0x701fb2869ce16d0f1d14f6705725adb0dec6799da29006dfc6fff83960298f21"),
    },
    // minus one so that inserting 1 from block works
    eth1DataVotes: newFilledArray(EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH - 1, {
      depositCount: 1,
      depositRoot: Buffer.alloc(32, 1),
      blockHash: Buffer.alloc(32, 1),
    }),
    eth1DepositIndex: pubkeys.length,
    // Registry
    validators: pubkeys.map((_, i) => ({
      pubkey: pubkeys[i],
      withdrawalCredentials: Buffer.alloc(32, i),
      effectiveBalance: 31000000000,
      slashed: false,
      activationEligibilityEpoch: 0,
      activationEpoch: 0,
      exitEpoch: Infinity,
      withdrawableEpoch: Infinity,
    })),
    balances: Array.from({length: pubkeys.length}, () => 31217089836),
    randaoMixes: Array.from({length: EPOCHS_PER_HISTORICAL_VECTOR}, (_, i) => Buffer.alloc(32, i)),
    // Slashings
    slashings: ssz.phase0.Slashings.defaultValue(),
    previousEpochAttestations: [],
    currentEpochAttestations: [],
    // Finality
    justificationBits: BitArray.fromBitLen(4),
    previousJustifiedCheckpoint: {
      epoch: currentEpoch - 2,
      root: fromHexString("0x3fe60bf06a57b0956cd1f8181d26649cf8bf79e48bf82f55562e04b33d4785d4"),
    },
    currentJustifiedCheckpoint: {
      epoch: currentEpoch - 1,
      root: fromHexString("0x3ba0913d2fb5e4cbcfb0d39eb15803157c1e769d63b8619285d8fdabbd8181c7"),
    },
    finalizedCheckpoint: {
      epoch: currentEpoch - 3,
      root: fromHexString("0x122b8ff579d0c8f8a8b66326bdfec3f685007d2842f01615a0768870961ccc17"),
    },
  };
}

export function generateTestCachedBeaconStateOnlyValidators({
  vc,
  slot,
}: {
  vc: number;
  slot: Slot;
}): CachedBeaconStateAllForks {
  // Generate only some publicKeys
  const {pubkeys, pubkeysMod, pubkeysModObj} = getPubkeys(vc);

  // Manually sync pubkeys to prevent doing BLS opts 110_000 times
  const pubkey2index = new PubkeyIndexMap();
  const index2pubkey = [] as PublicKey[];
  for (let i = 0; i < vc; i++) {
    const pubkey = pubkeysMod[i % keypairsMod];
    const pubkeyObj = pubkeysModObj[i % keypairsMod];
    pubkey2index.set(pubkey, i);
    index2pubkey.push(pubkeyObj);
  }

  const state = ssz.phase0.BeaconState.defaultViewDU();
  state.slot = slot;

  const activeValidator = ssz.phase0.Validator.toViewDU({
    pubkey: Buffer.alloc(48, 0),
    withdrawalCredentials: Buffer.alloc(32, 0),
    effectiveBalance: MAX_EFFECTIVE_BALANCE,
    slashed: false,
    activationEligibilityEpoch: 0,
    activationEpoch: 0,
    exitEpoch: Infinity,
    withdrawableEpoch: Infinity,
  });

  for (let i = 0; i < vc; i++) {
    const validator = activeValidator.clone();
    validator.pubkey = pubkeys[i];
    state.validators.push(validator);
  }

  state.balances = ssz.phase0.Balances.toViewDU(newFilledArray(pubkeys.length, MAX_EFFECTIVE_BALANCE));
  state.randaoMixes = ssz.phase0.RandaoMixes.toViewDU(
    newFilledArray(EPOCHS_PER_HISTORICAL_VECTOR, Buffer.alloc(32, 0xdd))
  );

  // Commit ViewDU changes
  state.commit();

  // Sanity check for .commit() above
  if (state.validators.length !== vc) {
    throw Error(`Wrong number of validators in the state: ${state.validators.length} !== ${vc}`);
  }

  return createCachedBeaconState(state, {
    config: createBeaconConfig(config, state.genesisValidatorsRoot),
    pubkey2index,
    index2pubkey,
  });
}
