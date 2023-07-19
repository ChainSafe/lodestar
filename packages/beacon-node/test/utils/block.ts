import {BitVectorType, ValueOf} from "@chainsafe/ssz";
import {allForks, ssz} from "@lodestar/types";
import {
  BYTES_PER_LOGS_BLOOM,
  ForkSeq,
  MAX_ATTESTATIONS,
  MAX_ATTESTER_SLASHINGS,
  MAX_BLOB_COMMITMENTS_PER_BLOCK,
  MAX_BLS_TO_EXECUTION_CHANGES,
  MAX_BYTES_PER_TRANSACTION,
  MAX_DEPOSITS,
  MAX_EXTRA_DATA_BYTES,
  MAX_PROPOSER_SLASHINGS,
  MAX_TRANSACTIONS_PER_PAYLOAD,
  MAX_VOLUNTARY_EXITS,
  MAX_WITHDRAWALS_PER_PAYLOAD,
  SYNC_COMMITTEE_SIZE,
} from "@lodestar/params";
import {ForkInfo, createBeaconConfig, defaultChainConfig} from "@lodestar/config";
import {computeStartSlotAtEpoch, executionPayloadToPayloadHeader} from "@lodestar/state-transition";
import * as phase0 from "@lodestar/types/phase0/types.js";
import * as altair from "@lodestar/types/altair/types.js";
import * as bellatrix from "@lodestar/types/bellatrix/types.js";
import {CommonExecutionPayloadType} from "@lodestar/types/bellatrix/sszTypes.js";
import * as capella from "@lodestar/types/capella/types.js";
import * as deneb from "@lodestar/types/deneb/types.js";
import {randBytesArray, randNumber, randNumberBigInt, randBetween, randBetweenBigInt} from "@lodestar/utils";

const config = createBeaconConfig(defaultChainConfig, randBytesArray(32));

export function getMockSignedBeaconBlockHeaderBigint(slot: number): phase0.SignedBeaconBlockHeaderBigint {
  return {
    message: {
      slot: BigInt(slot),
      proposerIndex: randNumber(6),
      parentRoot: randBytesArray(32),
      bodyRoot: randBytesArray(32),
      stateRoot: randBytesArray(32),
    },
    signature: randBytesArray(96),
  };
}

export function getMockProposerSlashings(slot: number): phase0.ProposerSlashing[] {
  const slashings: phase0.ProposerSlashing[] = [];
  for (let i = 1; i <= randBetween(1, MAX_PROPOSER_SLASHINGS); i++) {
    slashings.push({
      signedHeader1: getMockSignedBeaconBlockHeaderBigint(slot),
      signedHeader2: getMockSignedBeaconBlockHeaderBigint(slot),
    });
  }
  return slashings;
}

export function getMockCheckpointBigint(): ValueOf<typeof ssz.phase0.CheckpointBigint> {
  return {
    epoch: randNumberBigInt(1),
    root: randBytesArray(32),
  };
}

export function getMockAttestationBigInt(slot: number): phase0.AttestationDataBigint {
  return {
    slot: BigInt(slot),
    beaconBlockRoot: randBytesArray(32),
    index: randNumberBigInt(1),
    source: getMockCheckpointBigint(),
    target: getMockCheckpointBigint(),
  };
}

export function getMockIndexedAttestationBigint(slot: number): phase0.IndexedAttestationBigint {
  return {
    attestingIndices: ssz.phase0.CommitteeIndices.defaultValue(),
    data: getMockAttestationBigInt(slot),
    signature: randBytesArray(96),
  };
}

export function getMockAttesterSlashings(slot: number): phase0.AttesterSlashing[] {
  const slashings: phase0.AttesterSlashing[] = [];
  for (let i = 1; i <= randBetween(1, MAX_ATTESTER_SLASHINGS); i++) {
    slashings.push({
      attestation1: getMockIndexedAttestationBigint(slot),
      attestation2: getMockIndexedAttestationBigint(slot),
    });
  }
  return slashings;
}

export function getMockCheckpoint(): phase0.Checkpoint {
  return {
    epoch: randNumber(1),
    root: randBytesArray(32),
  };
}

export function getMockAttestation(slot: number): phase0.AttestationData {
  return {
    slot,
    beaconBlockRoot: randBytesArray(32),
    index: randNumber(1),
    source: getMockCheckpoint(),
    target: getMockCheckpoint(),
  };
}

export function getMockAttestations(slot: number): phase0.Attestation[] {
  const attestations: phase0.Attestation[] = [];
  for (let i = 1; i <= randBetween(1, MAX_ATTESTATIONS); i++) {
    attestations.push({
      aggregationBits: ssz.phase0.CommitteeBits.defaultValue(),
      data: getMockAttestation(slot),
      signature: randBytesArray(96),
    });
  }
  return attestations;
}

export function getMockDepositData(): phase0.DepositData {
  return {
    pubkey: randBytesArray(48),
    withdrawalCredentials: randBytesArray(32),
    amount: randNumber(4),
    signature: randBytesArray(96),
  };
}

export function getMockDeposits(): phase0.Deposit[] {
  const deposits: phase0.Deposit[] = [];
  for (let i = 1; i <= randBetween(1, MAX_DEPOSITS); i++) {
    deposits.push({
      proof: ssz.phase0.DepositProof.defaultValue(),
      data: getMockDepositData(),
    });
  }
  return deposits;
}

export function getMockSignedVoluntaryExits(): phase0.SignedVoluntaryExit[] {
  const exits: phase0.SignedVoluntaryExit[] = [];
  for (let i = 1; i <= randBetween(1, MAX_VOLUNTARY_EXITS); i++) {
    exits.push({
      message: {
        epoch: randNumber(4),
        validatorIndex: randNumber(5),
      },
      signature: randBytesArray(96),
    });
  }
  return exits;
}

export function getMockPhase0Block(epochsAfterFork = 1000): phase0.SignedBeaconBlock {
  const slot = computeStartSlotAtEpoch(0 + epochsAfterFork);
  const block = ssz.phase0.SignedBeaconBlock.defaultValue();
  block.signature = randBytesArray(96);
  block.message = {
    slot,
    proposerIndex: randNumber(6),
    parentRoot: randBytesArray(32),
    stateRoot: randBytesArray(32),
    body: {
      randaoReveal: randBytesArray(96),
      eth1Data: {
        blockHash: randBytesArray(32),
        depositRoot: randBytesArray(32),
        depositCount: randNumber(2),
      },
      graffiti: randBytesArray(32),
      proposerSlashings: getMockProposerSlashings(slot),
      attesterSlashings: getMockAttesterSlashings(slot),
      attestations: getMockAttestations(slot),
      deposits: getMockDeposits(),
      voluntaryExits: getMockSignedVoluntaryExits(),
    },
  };
  return block;
}

export function getMockAltairBlock(epochsAfterFork = 1000): altair.SignedBeaconBlock {
  const block = getMockPhase0Block();
  return ssz.altair.SignedBeaconBlock.clone({
    signature: block.signature,
    message: {
      ...block.message,
      slot: computeStartSlotAtEpoch(config.ALTAIR_FORK_EPOCH + epochsAfterFork),
      body: {
        ...block.message.body,
        syncAggregate: {
          syncCommitteeBits: new BitVectorType(SYNC_COMMITTEE_SIZE).defaultValue(),
          syncCommitteeSignature: randBytesArray(96),
        },
      },
    },
  });
}

function getMockCommonExecutionFields(): ValueOf<typeof CommonExecutionPayloadType> {
  const payload = ssz.bellatrix.CommonExecutionPayloadType.defaultValue();
  payload.parentHash = randBytesArray(32);
  payload.feeRecipient = randBytesArray(20);
  payload.stateRoot = randBytesArray(32);
  payload.receiptsRoot = randBytesArray(32);
  payload.logsBloom = randBytesArray(BYTES_PER_LOGS_BLOOM);
  payload.prevRandao = randBytesArray(32);
  payload.blockNumber = randNumber(6);
  payload.gasLimit = 30_000_000;
  payload.gasUsed = randBetween(0.1 * payload.gasLimit, 0.9 * payload.gasLimit);
  payload.timestamp = randBetween(0.9 * Date.now(), Date.now());
  payload.extraData = randBytesArray(randBetween(0, MAX_EXTRA_DATA_BYTES));
  payload.baseFeePerGas = randBetweenBigInt(0, 1_000_000_000);
  return payload;
}

export function getMockBellatrixExecutionPayload(): bellatrix.ExecutionPayload {
  const transactions: Uint8Array[] = [];
  for (let i = 1; i <= randBetween(1, MAX_TRANSACTIONS_PER_PAYLOAD); i++) {
    const size = randBetween(0.2 * MAX_BYTES_PER_TRANSACTION, 0.8 * MAX_BYTES_PER_TRANSACTION);
    transactions.push(randBytesArray(size));
  }

  return ssz.bellatrix.ExecutionPayload.clone({
    ...getMockCommonExecutionFields(),
    blockHash: randBytesArray(32),
    transactions,
  });
}

export function getMockBellatrixBlock(epochsAfterFork = 1000): bellatrix.SignedBeaconBlock {
  const block = getMockAltairBlock();
  return ssz.bellatrix.SignedBeaconBlock.clone({
    signature: block.signature,
    message: {
      ...block.message,
      slot: computeStartSlotAtEpoch(config.BELLATRIX_FORK_EPOCH + epochsAfterFork),
      body: {
        ...block.message.body,
        executionPayload: getMockBellatrixExecutionPayload(),
      },
    },
  });
}

export function getMockCapellaExecutionPayload(): capella.ExecutionPayload {
  const withdrawals: capella.Withdrawal[] = [];
  for (let i = 1; i <= randBetween(1, MAX_WITHDRAWALS_PER_PAYLOAD); i++) {
    withdrawals.push({
      index: randNumber(5),
      validatorIndex: randNumber(5),
      address: randBytesArray(20),
      amount: randNumberBigInt(5),
    });
  }

  return ssz.capella.ExecutionPayload.clone({
    ...getMockBellatrixExecutionPayload(),
    withdrawals,
  });
}

export function getSignedBlsToExecutionChanges(): capella.SignedBLSToExecutionChange[] {
  const blsToExecutionChanges: capella.SignedBLSToExecutionChange[] = [];
  for (let i = 1; i <= randBetween(1, MAX_BLS_TO_EXECUTION_CHANGES); i++) {
    blsToExecutionChanges.push({
      signature: randBytesArray(96),
      message: {
        validatorIndex: randNumber(5),
        fromBlsPubkey: randBytesArray(48),
        toExecutionAddress: randBytesArray(20),
      },
    });
  }
  return blsToExecutionChanges;
}

export function getMockCapellaBlock(epochsAfterFork = 1000): capella.SignedBeaconBlock {
  const block = getMockBellatrixBlock();
  return ssz.capella.SignedBeaconBlock.clone({
    signature: block.signature,
    message: {
      ...block.message,
      slot: computeStartSlotAtEpoch(config.CAPELLA_FORK_EPOCH + epochsAfterFork),
      body: {
        ...block.message.body,
        executionPayload: getMockCapellaExecutionPayload(),
        blsToExecutionChanges: getSignedBlsToExecutionChanges(),
      },
    },
  });
}

export function getMockDenebExecutionPayload(): deneb.ExecutionPayload {
  return ssz.deneb.ExecutionPayload.clone({
    ...getMockCapellaExecutionPayload(),
    dataGasUsed: randNumberBigInt(5),
    excessDataGas: randNumberBigInt(5),
  });
}

export function getMockDenebBlock(epochsAfterFork = 1000): deneb.SignedBeaconBlock {
  const blobKzgCommitments: Uint8Array[] = [];
  for (let i = 1; i <= randBetween(1, MAX_BLOB_COMMITMENTS_PER_BLOCK); i++) {
    blobKzgCommitments.push(randBytesArray(48));
  }

  const block = getMockCapellaBlock();
  return ssz.deneb.SignedBeaconBlock.clone({
    signature: block.signature,
    message: {
      ...block.message,
      slot: computeStartSlotAtEpoch(config.DENEB_FORK_EPOCH + epochsAfterFork),
      body: {
        ...block.message.body,
        executionPayload: getMockDenebExecutionPayload(),
        blsToExecutionChanges: getSignedBlsToExecutionChanges(),
        blobKzgCommitments: blobKzgCommitments,
      },
    },
  });
}

export function getMockSignedBeaconBlock(forkSeq: ForkSeq): allForks.SignedBeaconBlock {
  switch (forkSeq) {
    case ForkSeq.altair:
      return getMockAltairBlock();
    case ForkSeq.bellatrix:
      return getMockBellatrixBlock();
    case ForkSeq.capella:
      return getMockCapellaBlock();
    case ForkSeq.deneb:
      return getMockDenebBlock();
    case ForkSeq.phase0:
    default:
      return getMockPhase0Block();
  }
}

export function convertFullToBlindedMock(
  info: ForkInfo,
  block: allForks.SignedBeaconBlock
): allForks.SignedBlindedBeaconBlock {
  if (info.seq < ForkSeq.bellatrix) {
    return block;
  }

  return ssz[info.name as "bellatrix"].SignedBlindedBeaconBlock.clone({
    signature: block.signature,
    message: {
      ...block.message,
      body: {
        ...(block.message.body as bellatrix.BeaconBlockBody),
        executionPayloadHeader: executionPayloadToPayloadHeader(
          info.seq,
          (block.message.body as bellatrix.BeaconBlockBody).executionPayload
        ),
      },
    },
  });
}
