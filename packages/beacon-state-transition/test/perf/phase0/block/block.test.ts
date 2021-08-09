import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {SecretKey} from "@chainsafe/blst";
import {
  DOMAIN_DEPOSIT,
  MAX_ATTESTATIONS,
  MAX_ATTESTER_SLASHINGS,
  MAX_DEPOSITS,
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS,
} from "@chainsafe/lodestar-params";
import {config} from "@chainsafe/lodestar-config/default";
import {List} from "@chainsafe/ssz";
import {allForks, computeDomain, computeEpochAtSlot, computeSigningRoot, ZERO_HASH} from "../../../../src";
import {generatePerfTestCachedStatePhase0, perfStateId} from "../../util";
import {LeafNode} from "@chainsafe/persistent-merkle-tree";

// As of Jun 12 2021
// Process block
// ================================================================
// Process block with 0 validator exit                                    233.6434 ops/s      4.280027 ms/op   3491 runs    15.01 s
// Process block with 1 validator exit                                    41.33581 ops/s      24.19210 ms/op    619 runs    15.00 s
// Process block with 16 validator exits                                  42.34492 ops/s      23.61558 ms/op    635 runs    15.02 s

// Processing a block consist of three steps
// 1. Verifying signatures
// 2. Running block processing (state transition function)
// 3. Hashing the state
//
// Performance cost of each block depends on the size of the state + the operation counts in the block
//
// ### Verifying signatures
// Signature verification is done in bulk using batch BLS verification. Performance is proportional to the amount of
// sigs to verify and the cost to construct the signature sets from TreeBacked data.
//
// - Proposer sig:           1 single
// - RandaoReveal sig:       1 single
// - ProposerSlashings sigs: ops x 2 single
// - AttesterSlashings sigs: ops x 2 agg (90 bits on avg)
// - Attestations sigs:      ops x 1 agg (90 bits on avg)
// - VoluntaryExits sigs:    ops x 1 single
// - Deposits sigs:          ops x 1 single
//
// A mainnet average block has:
//   1 + 1 + 90 = 92 sigs
//   90 * 90 = 8100 pubkey aggregations
// A worst case block would have:
//   1 + 1 + 16 * 2 + 2 * 2 + 128 + 16 + 16 = 198 sigs
//   2 * 2 * 128 + 128 * 128 = 16896 pubkey aggregations
//
// ### Running block processing
// Block processing is relatively fast, most of the cost is reading and writing tree data.
//
//
//
//
// ### Hashing the state
// Hashing cost is dependant on how many nodes have been modified in the tree. After mutating the state, just count
// how many nodes have no cached _root, then multiply by the cost of hashing.
//

describe("Process block", () => {
  setBenchOpts({
    maxMs: 60 * 1000,
    minMs: 0 * 1000,
    runs: 1,
  });

  const baseState = generatePerfTestCachedStatePhase0();
  // const [oneValidatorExitBlock, maxValidatorExitBlock] = [1, MAX_VOLUNTARY_EXITS].map((numValidatorExits) => {
  //   const signedBlock = regularBlock.clone();
  //   const exitEpoch = baseState.epochCtx.currentShuffling.epoch;
  //   const voluntaryExits: phase0.SignedVoluntaryExit[] = [];
  //   for (let i = 0; i < numValidatorExits; i++) {
  //     voluntaryExits.push({
  //       message: {epoch: exitEpoch, validatorIndex: 40000 + i},
  //       signature: Buffer.alloc(96),
  //     });
  //   }
  //   signedBlock.message.body.voluntaryExits = (voluntaryExits as unknown) as List<phase0.SignedVoluntaryExit>;
  //   return signedBlock;
  // });

  // const block = regularBlock.clone();

  const worstCaseBlockState = baseState.clone();
  const worstCaseBlock = getBlock(worstCaseBlockState, {
    proposerSlashingLen: MAX_PROPOSER_SLASHINGS,
    attesterSlashingLen: MAX_ATTESTER_SLASHINGS,
    attestationLen: MAX_ATTESTATIONS,
    depositsLen: MAX_DEPOSITS,
    voluntaryExitLen: MAX_VOLUNTARY_EXITS,
    bitsLen: 128,
  });

  const averageMainnetBlockState = baseState.clone();
  const averageMainnetBlock = getBlock(averageMainnetBlockState, {
    proposerSlashingLen: 0,
    attesterSlashingLen: 0,
    attestationLen: 90,
    depositsLen: 0,
    voluntaryExitLen: 0,
    bitsLen: 90,
  });

  itBench(
    {id: `processBlock phase0 - worst case - ${perfStateId}`, beforeEach: () => worstCaseBlockState.clone()},
    (state) => {
      allForks.stateTransition(state as allForks.CachedBeaconState<allForks.BeaconState>, worstCaseBlock, {
        verifyProposer: false,
        verifySignatures: false,
        verifyStateRoot: false,
      });
    }
  );

  itBench(
    {id: `processBlock phase0 - average - ${perfStateId}`, beforeEach: () => averageMainnetBlockState.clone()},
    (state) => {
      allForks.stateTransition(state as allForks.CachedBeaconState<allForks.BeaconState>, averageMainnetBlock, {
        verifyProposer: false,
        verifySignatures: false,
        verifyStateRoot: false,
      });
    }
  );

  // Add ops

  // Test individual operations maxing them to the worst case
  // itBench(
  //   {id: `phase0 processAttestation - ${MAX_ATTESTATIONS} - ${perfStateId}`, beforeEach: () => originalState.clone()},
  //   (state) => {
  //     for (let i = 0; i < MAX_ATTESTATIONS; i++) {
  //       processAttestation(state, attestation, {}, false);
  //       allForks.stateTransition(state, signedBlock, {
  //         verifyProposer: false,
  //         verifySignatures: false,
  //         verifyStateRoot: false,
  //       });
  //     }
  //   }
  // );

  // const idPrefix = `Process block - ${perfStateId}`;

  // const testCases = [
  //   {signedBlock: regularBlock, id: `${idPrefix} - with 0 validator exit`},
  //   {signedBlock: oneValidatorExitBlock, id: `${idPrefix} - with 1 validator exit`},
  //   {signedBlock: maxValidatorExitBlock, id: `${idPrefix} - with ${MAX_VOLUNTARY_EXITS} validator exits`},
  // ];

  // for (const {id, signedBlock} of testCases) {
  //   itBench({id, beforeEach: () => originalState.clone()}, (state) => {
  //     allForks.stateTransition(state, signedBlock, {
  //       verifyProposer: false,
  //       verifySignatures: false,
  //       verifyStateRoot: false,
  //     });
  //   });
  // }

  // Process a regular mainnet block
  // Process a worst case block with all operations full
});

function getBlock(
  preState: allForks.CachedBeaconState<phase0.BeaconState>,
  {
    proposerSlashingLen,
    attesterSlashingLen,
    attestationLen,
    depositsLen,
    voluntaryExitLen,
    bitsLen,
  }: {
    proposerSlashingLen: number;
    attesterSlashingLen: number;
    attestationLen: number;
    depositsLen: number;
    voluntaryExitLen: number;
    bitsLen: number;
  }
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
  const attIndex = 0;
  const attCommittee = preState.epochCtx.getBeaconCommittee(attSlot, attIndex);
  const attSource =
    attEpoch === stateEpoch ? preState.currentJustifiedCheckpoint : preState.previousJustifiedCheckpoint;
  for (let i = 0; i < attestationLen; i++) {
    // Spread attesting indices through the whole range, offset on each attestation
    attestations.push({
      aggregationBits: getAggregationBits(attCommittee.length, bitsLen) as List<boolean>,
      data: {
        slot: attSlot,
        index: 0,
        beaconBlockRoot: rootB,
        source: attSource,
        target: {epoch: attEpoch, root: rootA},
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

function getDeposits(preState: allForks.CachedBeaconState<phase0.BeaconState>, count: number): List<phase0.Deposit> {
  const depositRootTree = ssz.phase0.DepositDataRootList.defaultTreeBacked();
  const depositCount = preState.eth1Data.depositCount;
  const withdrawalCredentials = Buffer.alloc(32, 0xee);

  const depositsData: phase0.DepositData[] = [];
  const deposits = ([] as phase0.Deposit[]) as List<phase0.Deposit>;

  for (let i = 0; i < count; i++) {
    const sk = SecretKey.fromBytes(Buffer.alloc(32, i + 1));
    const pubkey = sk.toPublicKey().toBytes();
    const depositMessage: phase0.DepositMessage = {pubkey, withdrawalCredentials, amount: BigInt(32e9)};
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
