import {config} from "@chainsafe/lodestar-config/default";
import {Gwei, phase0, ssz} from "@chainsafe/lodestar-types";
import bls, {CoordType, PublicKey} from "@chainsafe/bls";
import {fromHexString, List, TreeBacked} from "@chainsafe/ssz";
import {getBeaconProposerIndex} from "../../src/util/proposer";
import {allForks, computeEpochAtSlot} from "../../src";
import {computeCommitteeCount, PubkeyIndexMap} from "../../src/allForks";
import {profilerLogger} from "../utils/logger";
import {interopPubkeysCached} from "../utils/interop";
import {PendingAttestation} from "@chainsafe/lodestar-types/phase0";
import {intDiv} from "@chainsafe/lodestar-utils";
import {
  EPOCHS_PER_ETH1_VOTING_PERIOD,
  EPOCHS_PER_HISTORICAL_VECTOR,
  MAX_ATTESTATIONS,
  MAX_VALIDATORS_PER_COMMITTEE,
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT,
} from "@chainsafe/lodestar-params";

let tbState: TreeBacked<phase0.BeaconState> | null = null;
let cachedState23637: allForks.CachedBeaconState<phase0.BeaconState> | null = null;
let cachedState23638: allForks.CachedBeaconState<phase0.BeaconState> | null = null;
let signedBlock: TreeBacked<phase0.SignedBeaconBlock> | null = null;
const logger = profilerLogger();

/**
 * Number of validators in prater is 210000 as of May 2021
 */
const numValidators = 250000;
const numKeyPairs = 100;

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function getPubkeys() {
  const pubkeysMod = interopPubkeysCached(numKeyPairs);
  const pubkeysModObj = pubkeysMod.map((pk) => bls.PublicKey.fromBytes(pk, CoordType.jacobian));
  const pubkeys = Array.from({length: numValidators}, (_, i) => pubkeysMod[i % numKeyPairs]);
  return {pubkeysMod, pubkeysModObj, pubkeys};
}

export function generatePerfTestCachedBeaconState(opts?: {
  goBackOneSlot: boolean;
}): allForks.CachedBeaconState<phase0.BeaconState> {
  // Generate only some publicKeys
  const {pubkeys, pubkeysMod, pubkeysModObj} = getPubkeys();

  // Manually sync pubkeys to prevent doing BLS opts 110_000 times
  const pubkey2index = new PubkeyIndexMap();
  const index2pubkey = [] as PublicKey[];
  for (let i = 0; i < numValidators; i++) {
    const pubkey = pubkeysMod[i % numKeyPairs];
    const pubkeyObj = pubkeysModObj[i % numKeyPairs];
    pubkey2index.set(pubkey, i);
    index2pubkey.push(pubkeyObj);
  }

  const origState = generatePerformanceState(pubkeys);
  if (!cachedState23637) {
    const state = origState.clone();
    state.slot -= 1;
    cachedState23637 = allForks.createCachedBeaconState(config, state, {
      pubkey2index,
      index2pubkey,
      skipSyncPubkeys: true,
    });
  }
  if (!cachedState23638) {
    cachedState23638 = allForks.processSlots(
      cachedState23637 as allForks.CachedBeaconState<allForks.BeaconState>,
      cachedState23637.slot + 1
    ) as allForks.CachedBeaconState<phase0.BeaconState>;
    cachedState23638.slot += 1;
  }
  const resultingState = opts && opts.goBackOneSlot ? cachedState23637 : cachedState23638;

  return resultingState.clone();
}

/**
 * This is generated from Medalla state 756416
 */
export function generatePerformanceState(pubkeysArg?: Uint8Array[]): TreeBacked<phase0.BeaconState> {
  if (!tbState) {
    const pubkeys = pubkeysArg || getPubkeys().pubkeys;

    const state = ssz.phase0.BeaconState.defaultValue();
    state.genesisTime = 1596546008;
    state.genesisValidatorsRoot = fromHexString("0x04700007fabc8282644aed6d1c7c9e21d38a03a0c4ba193f3afe428824b3a673");
    state.slot = 756416;
    state.fork = {
      currentVersion: fromHexString("0x00000001"),
      previousVersion: fromHexString("0x00000001"),
      epoch: 0,
    };
    state.latestBlockHeader = {
      slot: 756415,
      proposerIndex: 80882,
      parentRoot: fromHexString("0x5b83c3078e474b86af60043eda82a34c3c2e5ebf83146b14d9d909aea4163ef2"),
      stateRoot: fromHexString("0x2761ae355e8a53c11e0e37d5e417f8984db0c53fa83f1bc65f89c6af35a196a7"),
      bodyRoot: fromHexString("0x249a1962eef90e122fa2447040bfac102798b1dba9c73e5593bc5aa32eb92bfd"),
    };
    state.blockRoots = Array.from({length: SLOTS_PER_HISTORICAL_ROOT}, (_, i) => Buffer.alloc(32, i));
    state.stateRoots = Array.from({length: SLOTS_PER_HISTORICAL_ROOT}, (_, i) => Buffer.alloc(32, i));
    // historicalRoots
    state.eth1Data = {
      depositCount: pubkeys.length,
      depositRoot: fromHexString("0xcb1f89a924cfd31224823db5a41b1643f10faa7aedf231f1e28887f6ee98c047"),
      blockHash: fromHexString("0x701fb2869ce16d0f1d14f6705725adb0dec6799da29006dfc6fff83960298f21"),
    };
    state.eth1DataVotes = (Array.from(
      // minus one so that inserting 1 from block works
      {length: EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH - 1},
      (_, i) => {
        return {
          depositCount: i,
          depositRoot: Buffer.alloc(32, i),
          blockHash: Buffer.alloc(32, i),
        };
      }
    ) as unknown) as List<phase0.Eth1Data>;
    state.eth1DepositIndex = pubkeys.length;
    state.validators = pubkeys.map((_, i) => ({
      pubkey: pubkeys[i],
      withdrawalCredentials: Buffer.alloc(32, i),
      effectiveBalance: BigInt(31000000000),
      slashed: false,
      activationEligibilityEpoch: 0,
      activationEpoch: 0,
      exitEpoch: Infinity,
      withdrawableEpoch: Infinity,
    })) as List<phase0.Validator>;
    state.balances = Array.from({length: pubkeys.length}, () => BigInt(31217089836)) as List<Gwei>;
    state.randaoMixes = Array.from({length: EPOCHS_PER_HISTORICAL_VECTOR}, (_, i) => Buffer.alloc(32, i));
    // no slashings
    const currentEpoch = computeEpochAtSlot(state.slot - 1);
    const previousEpoch = currentEpoch - 1;
    state.previousJustifiedCheckpoint = {
      epoch: currentEpoch - 2,
      root: fromHexString("0x3fe60bf06a57b0956cd1f8181d26649cf8bf79e48bf82f55562e04b33d4785d4"),
    };
    state.currentJustifiedCheckpoint = {
      epoch: currentEpoch - 1,
      root: fromHexString("0x3ba0913d2fb5e4cbcfb0d39eb15803157c1e769d63b8619285d8fdabbd8181c7"),
    };
    state.finalizedCheckpoint = {
      epoch: currentEpoch - 3,
      root: fromHexString("0x122b8ff579d0c8f8a8b66326bdfec3f685007d2842f01615a0768870961ccc17"),
    };
    // previous epoch attestations
    const numPrevAttestations = SLOTS_PER_EPOCH * MAX_ATTESTATIONS;
    const activeValidatorCount = pubkeys.length;
    const committeesPerSlot = computeCommitteeCount(activeValidatorCount);
    state.previousEpochAttestations = Array.from({length: numPrevAttestations}, (_, i) => {
      const slotInEpoch = intDiv(i, MAX_ATTESTATIONS);
      return {
        aggregationBits: Array.from({length: MAX_VALIDATORS_PER_COMMITTEE}, () => true) as List<boolean>,
        data: {
          beaconBlockRoot: state.blockRoots[slotInEpoch % SLOTS_PER_HISTORICAL_ROOT],
          index: i % committeesPerSlot,
          slot: previousEpoch * SLOTS_PER_EPOCH + slotInEpoch,
          source: state.previousJustifiedCheckpoint,
          target: state.currentJustifiedCheckpoint,
        },
        inclusionDelay: 1,
        proposerIndex: i,
      };
    }) as List<PendingAttestation>;
    // current epoch attestations
    const numCurAttestations = (SLOTS_PER_EPOCH - 1) * MAX_ATTESTATIONS;
    state.currentEpochAttestations = Array.from({length: numCurAttestations}, (_, i) => {
      const slotInEpoch = intDiv(i, MAX_ATTESTATIONS);
      return {
        aggregationBits: Array.from({length: MAX_VALIDATORS_PER_COMMITTEE}, () => true) as List<boolean>,
        data: {
          beaconBlockRoot: state.blockRoots[slotInEpoch % SLOTS_PER_HISTORICAL_ROOT],
          index: i % committeesPerSlot,
          slot: currentEpoch * SLOTS_PER_EPOCH + slotInEpoch,
          source: state.currentJustifiedCheckpoint,
          target: {
            epoch: currentEpoch,
            root: state.blockRoots[(currentEpoch * SLOTS_PER_EPOCH) % SLOTS_PER_HISTORICAL_ROOT],
          },
        },
        inclusionDelay: 1,
        proposerIndex: i,
      };
    }) as List<PendingAttestation>;
    // no justificationBits
    tbState = ssz.phase0.BeaconState.createTreeBackedFromStruct(state);
    logger.verbose("Loaded state", {
      slot: tbState.slot,
      numValidators: tbState.validators.length,
    });
    // cache roots
    tbState.hashTreeRoot();
  }
  return tbState.clone();
}

/**
 * This is generated from Medalla block 756417
 */
export function generatePerformanceBlock(): TreeBacked<phase0.SignedBeaconBlock> {
  if (!signedBlock) {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    const parentState = generatePerformanceState();
    const newState = parentState.clone();
    newState.slot++;
    block.message.slot = newState.slot;
    block.message.proposerIndex = getBeaconProposerIndex(newState);
    block.message.parentRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(parentState.latestBlockHeader);
    block.message.stateRoot = fromHexString("0x6c86ca3c4c6688cf189421b8a68bf2dbc91521609965e6f4e207d44347061fee");
    block.message.body.randaoReveal = fromHexString(
      "0x8a5d2673c48f22f6ed19462efec35645db490df29eed2f56321dbe4a89b2463b0c902095a7ab74a2dc5b7f67edb1a19507ea3d4361d5af9cb0a524945c91638dfd6568841486813a2c45142659d6d9403f5081febb123a7931edbc248b9d0025"
    );
    // eth1Data, graffiti, attestations
    signedBlock = ssz.phase0.SignedBeaconBlock.createTreeBackedFromStruct(block);
    logger.verbose("Loaded block", {slot: signedBlock.message.slot});
  }
  return signedBlock.clone();
}

export function runOnce<T>(fn: () => T): () => T {
  let value: T | null = null;
  return function () {
    if (value === null) {
      value = fn();
    }
    return value;
  };
}
