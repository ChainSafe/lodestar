import {serialize, treeHash} from "@chainsafesystems/ssz";
import xor from "buffer-xor";
import BN from "bn.js";

import {
  AttestationData,
  AttestationDataAndCustodyBit,
  Crosslink,
  bool,
  bytes32,
  bytes48,
  bytes96,
  BeaconBlock,
  BeaconState,
  Eth1DataVote,
  PendingAttestation,
  ProposalSignedData,
  Validator,
  uint64,
  DepositData,
  VoluntaryExit,
  Transfer,
  int,
} from "../../types";

import {
  BEACON_CHAIN_SHARD_NUMBER,
  Domain,
  EMPTY_SIGNATURE,
  LATEST_RANDAO_MIXES_LENGTH,
  MAX_ATTESTATIONS,
  MAX_ATTESTER_SLASHINGS,
  MAX_PROPOSER_SLASHINGS,
  MIN_ATTESTATION_INCLUSION_DELAY,
  SLOTS_PER_EPOCH,
  ZERO_HASH,
  MAX_DEPOSITS,
  DEPOSIT_CONTRACT_TREE_DEPTH,
  MAX_TRANSFERS,
  MIN_DEPOSIT_AMOUNT,
  BLS_WITHDRAWAL_PREFIX_BYTE,
  MAX_VOLUNTARY_EXITS,
} from "../../constants";

import {
  getAttestationParticipants,
  getBeaconProposerIndex,
  getBitfieldBit,
  getBlockRoot,
  getCrosslinkCommitteesAtSlot,
  getCurrentEpoch,
  getDomain,
  getEpochStartSlot,
  getRandaoMix,
  hash,
  intToBytes,
  isDoubleVote,
  isSurroundVote,
  slotToEpoch,
  slashValidator,
  verifySlashableAttestation,
  getEntryExitEffectEpoch,
} from "../../helpers/stateTransitionHelpers";
import { processDeposit, initiateValidatorExit } from "../state";

// TODO: unstub this, connect bls-js repo
function blsVerify(pubkey: bytes48, messageHash: bytes32, signature: bytes96, domain: uint64): bool {
  return true;
}

function blsVerifyMultiple(pubkeys: bytes48[], messageHashes: bytes32[], signature: bytes96, domain: uint64): bool {
  return true;
}

function blsAggregatePubkeys(pubkeys: bytes48[]): bytes48 {
  return Buffer.alloc(48);
}

function verifyMerkleBranch(leaf: bytes32, branch: bytes32[], depth: int, index: int, root: bytes32): bool {
  return true;
}

export function processBlock(state: BeaconState, block: BeaconBlock, verifySignatures: bool): BeaconState {
  const currentEpoch = getCurrentEpoch(state);

  // Slot
  if (!block.slot.eq(state.slot)) {
    throw new Error("block root must equal state root");
  }

  // Proposer signature
  block.signature = EMPTY_SIGNATURE;
  const blockWithoutSignatureRoot: bytes32 = treeHash(block);

  const p: ProposalSignedData = {
    slot: state.slot,
    shard: BEACON_CHAIN_SHARD_NUMBER,
    blockRoot: blockWithoutSignatureRoot,
  };
  const proposalRoot = treeHash(p);

  const blockSignatureVerified = blsVerify(
    state.validatorRegistry[getBeaconProposerIndex(state, state.slot)].pubkey,
    proposalRoot,
    block.signature,
    getDomain(state.fork, currentEpoch, Domain.PROPOSAL),
  );

  if (!blockSignatureVerified) {
    throw new Error();
  }

  // RANDAO
  const proposer = state.validatorRegistry[getBeaconProposerIndex(state, state.slot)];
  const randaoRevealVerified = blsVerify(
    proposer.pubkey,
    intToBytes(currentEpoch, 32),
    block.randaoReveal,
    getDomain(state.fork, currentEpoch, Domain.PROPOSAL),
  );
  if (!randaoRevealVerified) {
    throw new Error();
  }
  state.latestRandaoMixes[currentEpoch.modn(LATEST_RANDAO_MIXES_LENGTH)] =
    xor(getRandaoMix(state, currentEpoch), hash(block.randaoReveal));

  // Eth1 data
  let eth1DataVote: Eth1DataVote = state.eth1DataVotes.find((vote) =>
    vote.eth1Data.blockHash.equals(block.eth1Data.blockHash) &&
    vote.eth1Data.depositRoot.equals(block.eth1Data.depositRoot));

  if (eth1DataVote) {
    eth1DataVote.voteCount = eth1DataVote.voteCount.addn(1);
  } else {
    state.eth1DataVotes.push({
      eth1Data: block.eth1Data,
      voteCount: new BN(1),
    });
  }

  // Transactions

  // Proposer slashings
  if (!(block.body.proposerSlashings.length <= MAX_PROPOSER_SLASHINGS)) {
    throw new Error();
  }
  for (const proposerSlashing of block.body.proposerSlashings) {
    const proposer: Validator =
      state.validatorRegistry[proposerSlashing.proposerIndex.toNumber()];

    if (!proposerSlashing.proposalData1.slot.eq(proposerSlashing.proposalData2.slot)) {
      throw new Error();
    }
    if (!proposerSlashing.proposalData1.shard.eq(proposerSlashing.proposalData2.shard)) {
      throw new Error();
    }
    if (!proposerSlashing.proposalData1.blockRoot.equals(proposerSlashing.proposalData2.blockRoot)) {
      throw new Error();
    }
    if (!(proposer.slashedEpoch.gt(currentEpoch))) {
      throw new Error();
    }
    const proposalData1Verified = blsVerify(
      proposer.pubkey,
      treeHash(proposerSlashing.proposalData1),
      proposerSlashing.proposalSignature1,
      getDomain(state.fork, slotToEpoch(proposerSlashing.proposalData1.slot), Domain.PROPOSAL)
    );
    if (!proposalData1Verified) {
      throw new Error();
    }
    const proposalData2Verified = blsVerify(
      proposer.pubkey,
      treeHash(proposerSlashing.proposalData2),
      proposerSlashing.proposalSignature2,
      getDomain(state.fork, slotToEpoch(proposerSlashing.proposalData2.slot), Domain.PROPOSAL)
    );
    if (!proposalData2Verified) {
      throw new Error();
    }
    slashValidator(state, proposerSlashing.proposerIndex);
  }

  // Attester slashings
  if (!(block.body.attesterSlashings.length <= MAX_ATTESTER_SLASHINGS)) {
    throw new Error();
  }
  for (const attesterSlashing of block.body.attesterSlashings) {
    const slashableAttestation1 = attesterSlashing.slashableAttestation1;
    const slashableAttestation2 = attesterSlashing.slashableAttestation2;

    if (serialize(slashableAttestation1.data, AttestationData).eq(serialize(slashableAttestation2.data, AttestationData))) {
      throw new Error();
    }
    if (isDoubleVote(slashableAttestation1.data, slashableAttestation2.data) ||
        isSurroundVote(slashableAttestation1.data, slashableAttestation2.data)) {
      throw new Error();
    }
    if (!verifySlashableAttestation(state, slashableAttestation1)) {
      throw new Error();
    }
    if (!verifySlashableAttestation(state, slashableAttestation2)) {
      throw new Error();
    }
    const slashableIndices = slashableAttestation1.validatorIndices
      .filter((validatorIndex1) => (
        slashableAttestation2.validatorIndices.find((validatorIndex2) => validatorIndex1.eq(validatorIndex2)) &&
        state.validatorRegistry[validatorIndex1.toNumber()].slashedEpoch.gt(currentEpoch)
      ));
    if (!(slashableIndices.length >= 1)) {
      throw new Error();
    }
    slashableIndices.forEach((index) => slashValidator(state, index));
  }

  // Attestations
  if (!(block.body.attestations.length <= MAX_ATTESTATIONS)) {
    throw new Error();
  }
  for (const attestation of block.body.attestations) {
    if (!(attestation.data.slot.lte(state.slot.subn(MIN_ATTESTATION_INCLUSION_DELAY))) ||
        !(state.slot.subn(MIN_ATTESTATION_INCLUSION_DELAY).lt(attestation.data.slot.addn(SLOTS_PER_EPOCH)))) {
      throw new Error();
    }
    const justifiedEpoch = slotToEpoch(attestation.data.slot.addn(1)).gte(currentEpoch) ?
      state.justifiedEpoch : state.previousJustifiedEpoch;
    if (!attestation.data.justifiedEpoch.eq(justifiedEpoch)) {
      throw new Error();
    }
    if (!attestation.data.justifiedBlockRoot.equals(getBlockRoot(state, getEpochStartSlot(attestation.data.justifiedEpoch)))) {
      throw new Error();
    }
    if(!serialize(state.latestCrosslinks[attestation.data.shard.toNumber()], Crosslink).eq(serialize(attestation.data.latestCrosslink), Crosslink) &&
      !serialize(state.latestCrosslinks[attestation.data.shard.toNumber()], Crosslink).eq(
        serialize({
          epoch: slotToEpoch(attestation.data.slot),
          shardBlockRoot: attestation.data.shardBlockRoot
        } as Crosslink, Crosslink))) {
      throw new Error();
    }

    // Remove this condition in Phase 1
    if (!(attestation.custodyBitfield.equals(Buffer.alloc(attestation.custodyBitfield.length)))) {
      throw new Error();
    }
    if ((attestation.aggregationBitfield.equals(Buffer.alloc(attestation.aggregationBitfield.length)))) {
      throw new Error();
    }

    const crosslinkCommittee = getCrosslinkCommitteesAtSlot(state, attestation.data.slot)
      .filter(({shard}) => shard.eq(attestation.data.shard))
      .map(({validatorIndices}) => validatorIndices)[0]
    for (let i = 0; i < crosslinkCommittee.length; i++) {
      if (getBitfieldBit(attestation.aggregationBitfield, i) === 0b0) {
        if (getBitfieldBit(attestation.custodyBitfield, i) !== 0b0) {
          throw new Error();
        }
      }
    }
    const participants = getAttestationParticipants(state, attestation.data, attestation.aggregationBitfield);
    const custodyBit1Participants = getAttestationParticipants(state, attestation.data, attestation.custodyBitfield);
    const custodyBit0Participants = participants.filter((i) => custodyBit1Participants.find((i2) => i === i2));

    const custodyBitsVerified = blsVerifyMultiple(
      [
        blsAggregatePubkeys(custodyBit0Participants.map((i) => state.validatorRegistry[i].pubkey)),
        blsAggregatePubkeys(custodyBit1Participants.map((i) => state.validatorRegistry[i].pubkey)),
      ],
      [
        treeHash({ data: attestation.data, custodyBit: false } as AttestationDataAndCustodyBit),
        treeHash({ data: attestation.data, custodyBit: true } as AttestationDataAndCustodyBit)
      ],
      attestation.aggregateSignature,
      getDomain(state.fork, slotToEpoch(attestation.data.slot), Domain.ATTESTATION)
    );
    if (!custodyBitsVerified) {
      throw new Error();
    }
    // Remove the following conditional in Phase 1
    if (attestation.data.shardBlockRoot.equals(ZERO_HASH)) {
      throw new Error();
    }
    state.latestAttestations.push({
      data: attestation.data,
      aggregationBitfield: attestation.aggregationBitfield,
      custodyBitfield: attestation.custodyBitfield,
      inclusionSlot: state.slot,
    } as PendingAttestation);
  }

  // Deposits
  if (!(block.body.deposits.length <= MAX_DEPOSITS)) {
    throw new Error();
  }
  // TODO: add logic to ensure that deposits from 1.0 chain are processed in order
  for (const deposit of block.body.deposits) {
    const serializedDepositData = serialize(deposit.depositData, DepositData);
    if (!deposit.index.eq(state.depositIndex)) {
      throw new Error();
    }
    if (!verifyMerkleBranch(hash(serializedDepositData), deposit.branch, DEPOSIT_CONTRACT_TREE_DEPTH, deposit.index.toNumber(), state.latestEth1Data.depositRoot)) {
      throw new Error();
    }
    processDeposit(
      state,
      deposit.depositData.depositInput.pubkey,
      deposit.depositData.amount,
      deposit.depositData.depositInput.proofOfPossession,
      deposit.depositData.depositInput.withdrawalCredentials
    );
    state.depositIndex = state.depositIndex.addn(1);
  }

  // Voluntary Exits
  if (!(block.body.voluntaryExits.length <= MAX_VOLUNTARY_EXITS)) {
    throw new Error();
  }
  for (const exit of block.body.voluntaryExits) {
    const validator = state.validatorRegistry[exit.validatorIndex.toNumber()];
    if (!(validator.exitEpoch.gt(getEntryExitEffectEpoch(currentEpoch)))) {
      throw new Error();
    }
    if (!currentEpoch.gte(exit.epoch)) {
      throw new Error();
    }
    const exitMessage = treeHash({
      epoch: exit.epoch,
      validatorIndex: exit.validatorIndex,
      signature: EMPTY_SIGNATURE
    } as VoluntaryExit);
    const exitMessageVerified = blsVerify(
      validator.pubkey,
      exitMessage,
      exit.signature,
      getDomain(state.fork, exit.epoch, Domain.EXIT)
    );
    if (!exitMessageVerified) {
      throw new Error();
    }
    initiateValidatorExit(state, exit.validatorIndex);
  }

  // Transfers
  // Note: Transfers are a temporary functionality for phases 0 and 1, to be removed in phase 2.
  if (!(block.body.transfers.length <= MAX_TRANSFERS)) {
    throw new Error();
  }
  for (const transfer of block.body.transfers) {
    if (!(state.validatorBalances[transfer.from.toNumber()].gte(transfer.amount))) {
      throw new Error();
    }
    if (!(state.validatorBalances[transfer.from.toNumber()].gte(transfer.fee))) {
      throw new Error();
    }
    if (!state.validatorBalances[transfer.from.toNumber()].eq(transfer.amount.add(transfer.fee)) &&
        !state.validatorBalances[transfer.from.toNumber()].gte(transfer.amount.add(transfer.fee).addn(MIN_DEPOSIT_AMOUNT))) {
      throw new Error();
    }
    if (!state.slot.eq(transfer.slot)) {
      throw new Error();
    }
    if (!currentEpoch.gte(state.validatorRegistry[transfer.from.toNumber()].withdrawalEpoch)) {
      throw new Error();
    }
    if (!state.validatorRegistry[transfer.from.toNumber()].withdrawalCredentials.equals(Buffer.concat([BLS_WITHDRAWAL_PREFIX_BYTE, hash(transfer.pubkey).slice(1)]))) {
      throw new Error();
    }
    const transferMessage = treeHash({
      from: transfer.from,
      to: transfer.to,
      amount: transfer.amount,
      fee: transfer.fee,
      slot: transfer.slot,
      signature: EMPTY_SIGNATURE
    } as Transfer);
    const transferMessageVerified = blsVerify(
      transfer.pubkey,
      transferMessage,
      transfer.signature,
      getDomain(state.fork, slotToEpoch(transfer.slot), Domain.TRANSFER)
    );
    if (!transferMessageVerified) {
      throw new Error();
    }
    state.validatorBalances[transfer.from.toNumber()] = state.validatorBalances[transfer.from.toNumber()].sub(transfer.amount.add(transfer.fee));
    state.validatorBalances[transfer.to.toNumber()] = state.validatorBalances[transfer.to.toNumber()].add(transfer.amount);
    state.validatorBalances[getBeaconProposerIndex(state, state.slot)] = state.validatorBalances[getBeaconProposerIndex(state, state.slot)].add(transfer.fee)
  }

  return state;
}
