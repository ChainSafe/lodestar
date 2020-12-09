import bls from "@chainsafe/bls";
import {Deposit} from "@chainsafe/lodestar-types";
import {verifyMerkleBranch, bigIntMin} from "@chainsafe/lodestar-utils";

import {DEPOSIT_CONTRACT_TREE_DEPTH, DomainType, FAR_FUTURE_EPOCH} from "../../constants";
import {computeDomain, computeSigningRoot, increaseBalance} from "../../util";
import {EpochContext, CachedValidatorsBeaconState} from "../util";

export function processDeposit(epochCtx: EpochContext, state: CachedValidatorsBeaconState, deposit: Deposit): void {
  const config = epochCtx.config;
  const {EFFECTIVE_BALANCE_INCREMENT, MAX_EFFECTIVE_BALANCE} = config.params;
  // verify the merkle branch
  if (
    !verifyMerkleBranch(
      config.types.DepositData.hashTreeRoot(deposit.data),
      Array.from({length: deposit.proof.length}, (_, i) => deposit.proof[i].valueOf() as Uint8Array),
      DEPOSIT_CONTRACT_TREE_DEPTH + 1,
      state.eth1DepositIndex,
      state.eth1Data.depositRoot.valueOf() as Uint8Array
    )
  ) {
    throw new Error("Deposit has invalid merkle proof");
  }

  // deposits must be processed in order
  state.eth1DepositIndex += 1;

  const pubkey = deposit.data.pubkey;
  const amount = deposit.data.amount;
  const cachedIndex = epochCtx.pubkey2index.get(pubkey);
  if (cachedIndex === undefined || !Number.isSafeInteger(cachedIndex) || cachedIndex >= state.validators.length) {
    // verify the deposit signature (proof of posession) which is not checked by the deposit contract
    const depositMessage = {
      pubkey: deposit.data.pubkey,
      withdrawalCredentials: deposit.data.withdrawalCredentials,
      amount: deposit.data.amount,
    };
    // fork-agnostic domain since deposits are valid across forks
    const domain = computeDomain(config, DomainType.DEPOSIT);
    const signingRoot = computeSigningRoot(config, config.types.DepositMessage, depositMessage, domain);
    if (!bls.verify(pubkey.valueOf() as Uint8Array, signingRoot, deposit.data.signature.valueOf() as Uint8Array)) {
      return;
    }

    // add validator and balance entries
    state.addValidator({
      pubkey: pubkey,
      withdrawalCredentials: deposit.data.withdrawalCredentials,
      activationEligibilityEpoch: FAR_FUTURE_EPOCH,
      activationEpoch: FAR_FUTURE_EPOCH,
      exitEpoch: FAR_FUTURE_EPOCH,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
      effectiveBalance: bigIntMin(amount - (amount % EFFECTIVE_BALANCE_INCREMENT), MAX_EFFECTIVE_BALANCE),
      slashed: false,
    });
    state.balances.push(amount);
  } else {
    // increase balance by deposit amount
    increaseBalance(state, cachedIndex, amount);
  }
  // now that there is a new validator, update the epoch context with the new pubkey
  epochCtx.syncPubkeys(state);
}
