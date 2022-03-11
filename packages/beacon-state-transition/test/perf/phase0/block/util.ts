import {altair, phase0, ssz} from "@chainsafe/lodestar-types";
import {SecretKey} from "@chainsafe/blst";
import {DOMAIN_DEPOSIT, SYNC_COMMITTEE_SIZE} from "@chainsafe/lodestar-params";
import {config} from "@chainsafe/lodestar-config/default";
import {List} from "@chainsafe/ssz";
import {
  computeDomain,
  computeEpochAtSlot,
  computeSigningRoot,
  ZERO_HASH,
  CachedBeaconStateAllForks,
} from "../../../../src";
import {LeafNode} from "@chainsafe/persistent-merkle-tree";
import {getBlockRoot, getBlockRootAtSlot} from "../../../../src";

export type BlockOpts = {
  proposerSlashingLen: number;
  attesterSlashingLen: number;
  attestationLen: number;
  depositsLen: number;
  voluntaryExitLen: number;
  bitsLen: number;
};
export type BlockAltairOpts = BlockOpts & {syncCommitteeBitsLen: number};

/**
 * Generate a block that would pass stateTransition with a customizable count of operations
 */
export function getBlockPhase0(
  preState: CachedBeaconStateAllForks,
  {proposerSlashingLen, attesterSlashingLen, attestationLen, depositsLen, voluntaryExitLen, bitsLen}: BlockOpts
): phase0.SignedBeaconBlock {
  const emptySig = Buffer.alloc(96);
  const rootA = Buffer.alloc(32, 0xda);
  const rootB = Buffer.alloc(32, 0xdb);
  const rootC = Buffer.alloc(32, 0xdc);

  const stateSlot = preState.slot;
  const stateEpoch = computeEpochAtSlot(stateSlot);

  // Space out exited indexes through the max available range to force expensive tree navigation
  const minActiveIndex = 0;
  const maxActiveIndex = 200_000;
  const totalExits = proposerSlashingLen + attesterSlashingLen * bitsLen + voluntaryExitLen;
  const exitedIndexStep = Math.floor((maxActiveIndex - minActiveIndex) / totalExits);
  const proposerSlashingStartIndex = minActiveIndex;
  const attesterSlashingStartIndex = proposerSlashingStartIndex + proposerSlashingLen * exitedIndexStep;
  const voluntaryExitStartIndex = attesterSlashingStartIndex + attesterSlashingLen * bitsLen * exitedIndexStep;

  const proposerSlashings = ([] as phase0.ProposerSlashing[]) as List<phase0.ProposerSlashing>;
  for (let i = 0; i < proposerSlashingLen; i++) {
    const proposerIndex = proposerSlashingStartIndex + i * exitedIndexStep;
    proposerSlashings.push({
      signedHeader1: {
        message: {slot: 1_800_000, proposerIndex, parentRoot: rootA, stateRoot: rootB, bodyRoot: rootC},
        signature: emptySig,
      },
      signedHeader2: {
        message: {slot: 1_800_000, proposerIndex, parentRoot: rootC, stateRoot: rootA, bodyRoot: rootB},
        signature: emptySig,
      },
    });
  }

  const attSlot = stateSlot - 2;
  const attEpoch = computeEpochAtSlot(attSlot);
  const attesterSlashings = ([] as phase0.AttesterSlashing[]) as List<phase0.AttesterSlashing>;
  for (let i = 0; i < attesterSlashingLen; i++) {
    // Double vote for 128 participants
    const startIndex = attesterSlashingStartIndex + i * bitsLen * exitedIndexStep;
    const attestingIndices = linspace(startIndex, bitsLen, exitedIndexStep) as List<number>;

    const attData: phase0.AttestationData = {
      slot: attSlot,
      index: 0,
      beaconBlockRoot: rootA,
      source: {epoch: stateEpoch - 3, root: rootC},
      target: {epoch: attEpoch, root: rootA},
    };
    attesterSlashings.push({
      attestation1: {
        attestingIndices,
        data: attData,
        signature: emptySig,
      },
      attestation2: {
        attestingIndices,
        data: {...attData, beaconBlockRoot: rootB},
        signature: emptySig,
      },
    });
  }

  const attestations = ([] as phase0.Attestation[]) as List<phase0.Attestation>;
  const committeeCountPerSlot = preState.getCommitteeCountPerSlot(attEpoch);
  const attSource =
    attEpoch === stateEpoch ? preState.currentJustifiedCheckpoint : preState.previousJustifiedCheckpoint;
  for (let i = 0; i < attestationLen; i++) {
    const attIndex = i % committeeCountPerSlot;
    const attCommittee = preState.epochCtx.getBeaconCommittee(attSlot, attIndex);
    // Spread attesting indices through the whole range, offset on each attestation
    attestations.push({
      aggregationBits: getAggregationBits(attCommittee.length, bitsLen) as List<boolean>,
      data: {
        slot: attSlot,
        index: attIndex,
        beaconBlockRoot: getBlockRootAtSlot(preState, attSlot),
        source: attSource,
        target: {epoch: attEpoch, root: getBlockRoot(preState, attEpoch)},
      },
      signature: emptySig,
    });
  }

  // Moved to different function since it's a bit complex
  const deposits = getDeposits(preState, depositsLen);

  const voluntaryExits = ([] as phase0.SignedVoluntaryExit[]) as List<phase0.SignedVoluntaryExit>;
  for (let i = 0; i < voluntaryExitLen; i++) {
    voluntaryExits.push({
      message: {
        epoch: stateEpoch,
        validatorIndex: voluntaryExitStartIndex + i * exitedIndexStep,
      },
      signature: emptySig,
    });
  }

  const slot = preState.slot + 1;
  return ssz.phase0.SignedBeaconBlock.createTreeBackedFromStruct({
    message: {
      slot,
      proposerIndex: preState.getBeaconProposer(slot),
      parentRoot: ssz.phase0.BeaconBlockHeader.hashTreeRoot(preState.latestBlockHeader),
      // TODO: Compute the state root properly!
      stateRoot: rootA,
      body: {
        randaoReveal: Buffer.alloc(96, 0xdd),
        eth1Data: {
          depositRoot: rootA,
          depositCount: 1000,
          blockHash: rootB,
        },
        graffiti: rootA,

        // Operations
        proposerSlashings,
        attesterSlashings,
        attestations,
        deposits,
        voluntaryExits,
      },
    },
    signature: emptySig,
  });
}

/**
 * Get an altair block.
 * This mutates the input preState as well to mark attestations not seen by the network.
 */
export function getBlockAltair(preState: CachedBeaconStateAllForks, opts: BlockAltairOpts): altair.SignedBeaconBlock {
  const emptySig = Buffer.alloc(96);
  const phase0Block = getBlockPhase0(preState as CachedBeaconStateAllForks, opts);
  const stateEpoch = computeEpochAtSlot(preState.slot);
  for (const attestation of phase0Block.message.body.attestations) {
    const attEpoch = computeEpochAtSlot(attestation.data.slot);
    const epochParticipation =
      attEpoch === stateEpoch ? preState.currentEpochParticipation : preState.previousEpochParticipation;
    const attestingIndices = preState.getAttestingIndices(attestation.data, attestation.aggregationBits);
    for (const index of attestingIndices) {
      epochParticipation.set(index, 0);
    }
  }
  return {
    message: {
      ...phase0Block.message,
      body: {
        ...phase0Block.message.body,
        syncAggregate: {
          syncCommitteeBits: getAggregationBits(SYNC_COMMITTEE_SIZE, opts.syncCommitteeBitsLen),
          syncCommitteeSignature: emptySig,
        },
      },
    },
    signature: emptySig,
  };
}

/**
 * Generate valid deposits with valid signatures and valid merkle proofs.
 * NOTE: Mutates `preState` to add the new `eth1Data.depositRoot`
 */
function getDeposits(preState: CachedBeaconStateAllForks, count: number): List<phase0.Deposit> {
  const depositRootTree = ssz.phase0.DepositDataRootList.defaultTreeBacked();
  const depositCount = preState.eth1Data.depositCount;
  const withdrawalCredentials = Buffer.alloc(32, 0xee);

  const depositsData: phase0.DepositData[] = [];
  const deposits = ([] as phase0.Deposit[]) as List<phase0.Deposit>;

  for (let i = 0; i < count; i++) {
    const sk = SecretKey.fromBytes(Buffer.alloc(32, i + 1));
    const pubkey = sk.toPublicKey().toBytes();
    const depositMessage: phase0.DepositMessage = {pubkey, withdrawalCredentials, amount: 32e9};
    // Sign with disposable keys
    const domain = computeDomain(DOMAIN_DEPOSIT, config.GENESIS_FORK_VERSION, ZERO_HASH);
    const signingRoot = computeSigningRoot(ssz.phase0.DepositMessage, depositMessage, domain);
    const signature = sk.sign(signingRoot).toBytes();
    const depositData: phase0.DepositData = {...depositMessage, signature};
    depositsData.push(depositData);

    // First, push all deposits to the tree to generate proofs against the same root
    const index = depositCount + i;
    const gindex = depositRootTree.type.getPropertyGindex(index);
    const depositDataRoot = ssz.phase0.DepositData.hashTreeRoot(depositData);
    depositRootTree.tree.setNode(gindex, new LeafNode(depositDataRoot), true);
  }

  // Once the tree is complete, create proofs for each
  for (let i = 0; i < count; i++) {
    const gindex = depositRootTree.type.getPropertyGindex(depositCount + i);
    const proof = depositRootTree.tree.getSingleProof(gindex);
    deposits.push({proof, data: depositsData[i]});
  }

  // Write eth1Data to state
  if (count > 0) {
    preState.eth1Data.depositCount = depositCount + count;
    preState.eth1Data.depositRoot = depositRootTree.hashTreeRoot();
  }

  return deposits;
}

function linspace(from: number, count: number, step: number): number[] {
  const max = from + count * step;
  const arr: number[] = [];
  for (let i = from; i < max; i += step) {
    arr.push(i);
  }
  return arr;
}

function getAggregationBits(len: number, participants: number): boolean[] {
  const bits: boolean[] = [];
  for (let i = 0; i < len; i++) {
    bits.push(i < participants);
  }
  return bits;
}
