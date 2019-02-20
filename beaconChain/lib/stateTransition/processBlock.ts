import assert from "assert";
import BN from "bn.js";
import xor from "buffer-xor";
import {serialize, treeHash} from "@chainsafesystems/ssz";

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
  assert(block.slot.eq(state.slot),
    "block root must equal state root");

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

  assert(blockSignatureVerified);

  // RANDAO
  const proposer = state.validatorRegistry[getBeaconProposerIndex(state, state.slot)];
  const randaoRevealVerified = blsVerify(
    proposer.pubkey,
    intToBytes(currentEpoch, 32),
    block.randaoReveal,
    getDomain(state.fork, currentEpoch, Domain.PROPOSAL),
  );
  assert(randaoRevealVerified);
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
  assert(block.body.proposerSlashings.length <= MAX_PROPOSER_SLASHINGS);
  for (const proposerSlashing of block.body.proposerSlashings) {
    const proposer: Validator =
      state.validatorRegistry[proposerSlashing.proposerIndex.toNumber()];

    assert(proposerSlashing.proposalData1.slot.eq(proposerSlashing.proposalData2.slot));
    assert(proposerSlashing.proposalData1.shard.eq(proposerSlashing.proposalData2.shard));
    assert(proposerSlashing.proposalData1.blockRoot.equals(proposerSlashing.proposalData2.blockRoot));
    assert(proposer.slashedEpoch.gt(currentEpoch));
    const proposalData1Verified = blsVerify(
      proposer.pubkey,
      treeHash(proposerSlashing.proposalData1),
      proposerSlashing.proposalSignature1,
      getDomain(state.fork, slotToEpoch(proposerSlashing.proposalData1.slot), Domain.PROPOSAL)
    );
    assert(proposalData1Verified);
    const proposalData2Verified = blsVerify(
      proposer.pubkey,
      treeHash(proposerSlashing.proposalData2),
      proposerSlashing.proposalSignature2,
      getDomain(state.fork, slotToEpoch(proposerSlashing.proposalData2.slot), Domain.PROPOSAL)
    );
    assert(proposalData2Verified);
    slashValidator(state, proposerSlashing.proposerIndex);
  }

  // Attester slashings
  assert(block.body.attesterSlashings.length <= MAX_ATTESTER_SLASHINGS);
  for (const attesterSlashing of block.body.attesterSlashings) {
    const slashableAttestation1 = attesterSlashing.slashableAttestation1;
    const slashableAttestation2 = attesterSlashing.slashableAttestation2;

    assert(!serialize(slashableAttestation1.data, AttestationData).eq(serialize(slashableAttestation2.data, AttestationData)));
    assert(isDoubleVote(slashableAttestation1.data, slashableAttestation2.data) ||
      isSurroundVote(slashableAttestation1.data, slashableAttestation2.data));
    assert(verifySlashableAttestation(state, slashableAttestation1));
    assert(verifySlashableAttestation(state, slashableAttestation2));
    const slashableIndices = slashableAttestation1.validatorIndices
      .filter((validatorIndex1) => (
        slashableAttestation2.validatorIndices.find((validatorIndex2) => validatorIndex1.eq(validatorIndex2)) &&
        state.validatorRegistry[validatorIndex1.toNumber()].slashedEpoch.gt(currentEpoch)
      ));
    assert(slashableIndices.length >= 1);
    slashableIndices.forEach((index) => slashValidator(state, index));
  }

  // Attestations
  assert(block.body.attestations.length <= MAX_ATTESTATIONS);
  for (const attestation of block.body.attestations) {
    assert(attestation.data.slot.lte(state.slot.subn(MIN_ATTESTATION_INCLUSION_DELAY)) &&
      state.slot.subn(MIN_ATTESTATION_INCLUSION_DELAY).lt(attestation.data.slot.addn(SLOTS_PER_EPOCH)));
    const justifiedEpoch = slotToEpoch(attestation.data.slot.addn(1)).gte(currentEpoch) ?
      state.justifiedEpoch : state.previousJustifiedEpoch;
    assert(attestation.data.justifiedEpoch.eq(justifiedEpoch));
    assert(attestation.data.justifiedBlockRoot.equals(getBlockRoot(state, getEpochStartSlot(attestation.data.justifiedEpoch))));
    assert(serialize(state.latestCrosslinks[attestation.data.shard.toNumber()], Crosslink).eq(serialize(attestation.data.latestCrosslink), Crosslink) ||
      serialize(state.latestCrosslinks[attestation.data.shard.toNumber()], Crosslink).eq(
        serialize({
          epoch: slotToEpoch(attestation.data.slot),
          shardBlockRoot: attestation.data.shardBlockRoot
        } as Crosslink, Crosslink)));

    // Remove this condition in Phase 1
    assert((attestation.custodyBitfield.equals(Buffer.alloc(attestation.custodyBitfield.length))));
    assert(attestation.aggregationBitfield.equals(Buffer.alloc(attestation.aggregationBitfield.length)));

    const crosslinkCommittee = getCrosslinkCommitteesAtSlot(state, attestation.data.slot)
      .filter(({shard}) => shard.eq(attestation.data.shard))
      .map(({validatorIndices}) => validatorIndices)[0]
    for (let i = 0; i < crosslinkCommittee.length; i++) {
      if (getBitfieldBit(attestation.aggregationBitfield, i) === 0b0) {
        assert(getBitfieldBit(attestation.custodyBitfield, i) === 0b0);
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
    assert(custodyBitsVerified);
    // Remove the following conditional in Phase 1
    assert(attestation.data.shardBlockRoot.equals(ZERO_HASH));
    state.latestAttestations.push({
      data: attestation.data,
      aggregationBitfield: attestation.aggregationBitfield,
      custodyBitfield: attestation.custodyBitfield,
      inclusionSlot: state.slot,
    } as PendingAttestation);
  }

  // Deposits
  assert(block.body.deposits.length <= MAX_DEPOSITS);
  // TODO: add logic to ensure that deposits from 1.0 chain are processed in order
  for (const deposit of block.body.deposits) {
    const serializedDepositData = serialize(deposit.depositData, DepositData);
    assert(deposit.index.eq(state.depositIndex));
    assert(verifyMerkleBranch(hash(serializedDepositData), deposit.branch, DEPOSIT_CONTRACT_TREE_DEPTH, deposit.index.toNumber(), state.latestEth1Data.depositRoot));
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
  assert(block.body.voluntaryExits.length <= MAX_VOLUNTARY_EXITS);
  for (const exit of block.body.voluntaryExits) {
    const validator = state.validatorRegistry[exit.validatorIndex.toNumber()];
    assert(validator.exitEpoch.gt(getEntryExitEffectEpoch(currentEpoch)));
    assert(currentEpoch.gte(exit.epoch));
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
    assert(exitMessageVerified);
    initiateValidatorExit(state, exit.validatorIndex);
  }

  // Transfers
  // Note: Transfers are a temporary functionality for phases 0 and 1, to be removed in phase 2.
  assert(block.body.transfers.length <= MAX_TRANSFERS);
  for (const transfer of block.body.transfers) {
    assert(state.validatorBalances[transfer.from.toNumber()].gte(transfer.amount));
    assert(state.validatorBalances[transfer.from.toNumber()].gte(transfer.fee));
    assert(state.validatorBalances[transfer.from.toNumber()].eq(transfer.amount.add(transfer.fee)) ||
      state.validatorBalances[transfer.from.toNumber()].gte(transfer.amount.add(transfer.fee).addn(MIN_DEPOSIT_AMOUNT)));
    assert(state.slot.eq(transfer.slot));
    assert(currentEpoch.gte(state.validatorRegistry[transfer.from.toNumber()].withdrawalEpoch));
    assert(state.validatorRegistry[transfer.from.toNumber()].withdrawalCredentials.equals(Buffer.concat([BLS_WITHDRAWAL_PREFIX_BYTE, hash(transfer.pubkey).slice(1)])));
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
    assert(transferMessageVerified);
    state.validatorBalances[transfer.from.toNumber()] = state.validatorBalances[transfer.from.toNumber()].sub(transfer.amount.add(transfer.fee));
    state.validatorBalances[transfer.to.toNumber()] = state.validatorBalances[transfer.to.toNumber()].add(transfer.amount);
    state.validatorBalances[getBeaconProposerIndex(state, state.slot)] = state.validatorBalances[getBeaconProposerIndex(state, state.slot)].add(transfer.fee)
  }

  return state;
}
