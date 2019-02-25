import assert from "assert";

import {treeHash} from "@chainsafesystems/ssz";

import {
  BeaconBlock,
  BeaconState,
  Transfer,
} from "../../../types";

import {
  BLS_WITHDRAWAL_PREFIX_BYTE,
  Domain,
  EMPTY_SIGNATURE,
  MAX_TRANSFERS,
  MIN_DEPOSIT_AMOUNT,
} from "../../../constants";

import {
  getBeaconProposerIndex,
  getCurrentEpoch,
  getDomain,
  hash,
  slotToEpoch,
} from "../../../helpers/stateTransitionHelpers";

import { blsVerify } from "../../stubs/bls";

export default function processTransfers(state: BeaconState, block: BeaconBlock): void {
  // Note: Transfers are a temporary functionality for phases 0 and 1, to be removed in phase 2.
  assert(block.body.transfers.length <= MAX_TRANSFERS);
  for (const transfer of block.body.transfers) {
    assert(state.validatorBalances[transfer.from.toNumber()].gte(transfer.amount));
    assert(state.validatorBalances[transfer.from.toNumber()].gte(transfer.fee));
    assert(state.validatorBalances[transfer.from.toNumber()].eq(transfer.amount.add(transfer.fee)) ||
      state.validatorBalances[transfer.from.toNumber()].gte(transfer.amount.add(transfer.fee).addn(MIN_DEPOSIT_AMOUNT)));
    assert(state.slot.eq(transfer.slot));
    assert(getCurrentEpoch(state).gte(state.validatorRegistry[transfer.from.toNumber()].withdrawalEpoch));
    assert(state.validatorRegistry[transfer.from.toNumber()].withdrawalCredentials.equals(Buffer.concat([BLS_WITHDRAWAL_PREFIX_BYTE, hash(transfer.pubkey).slice(1)])));
    const transferMessage = treeHash({
      from: transfer.from,
      to: transfer.to,
      amount: transfer.amount,
      fee: transfer.fee,
      slot: transfer.slot,
      signature: EMPTY_SIGNATURE,
    } as Transfer);
    const transferMessageVerified = blsVerify(
      transfer.pubkey,
      transferMessage,
      transfer.signature,
      getDomain(state.fork, slotToEpoch(transfer.slot), Domain.TRANSFER),
    );
    assert(transferMessageVerified);
    state.validatorBalances[transfer.from.toNumber()] = state.validatorBalances[transfer.from.toNumber()].sub(transfer.amount.add(transfer.fee));
    state.validatorBalances[transfer.to.toNumber()] = state.validatorBalances[transfer.to.toNumber()].add(transfer.amount);
    const proposerIndex = getBeaconProposerIndex(state, state.slot);
    state.validatorBalances[proposerIndex] = state.validatorBalances[proposerIndex].add(transfer.fee);
  }
}
