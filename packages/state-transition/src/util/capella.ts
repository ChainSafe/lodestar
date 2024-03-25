import {COMPOUNDING_WITHDRAWAL_PREFIX, ETH1_ADDRESS_WITHDRAWAL_PREFIX, ForkSeq, MAX_EFFECTIVE_BALANCE, MAX_EFFECTIVE_BALANCE_ELECTRA, MIN_ACTIVATION_BALANCE} from "@lodestar/params";

type ValidatorCredential = {
  effectiveBalance: number,
  withdrawableEpoch: number, 
  withdrawalCredentials: Uint8Array
}

/**
 * https://github.com/ethereum/consensus-specs/blob/3d235740e5f1e641d3b160c8688f26e7dc5a1894/specs/capella/beacon-chain.md#has_eth1_withdrawal_credential
 */
export function hasEth1WithdrawalCredential(withdrawalCredentials: Uint8Array): boolean {
  return withdrawalCredentials[0] === ETH1_ADDRESS_WITHDRAWAL_PREFIX;
}

export function hasCompoundingWithdrawalCredential(withdrawalCredentials: Uint8Array): boolean {
  return withdrawalCredentials[0] === COMPOUNDING_WITHDRAWAL_PREFIX;
}

export function getValidatorExcessBalance(withdrawalCredentials: Uint8Array, validatorBalance: number): number {
  // Compounding withdrawal credential only available since Electra
  if (hasCompoundingWithdrawalCredential(withdrawalCredentials)) {
    return validatorBalance - MAX_EFFECTIVE_BALANCE_ELECTRA;
  } else if (hasEth1WithdrawalCredential(withdrawalCredentials)) {
    return validatorBalance - MIN_ACTIVATION_BALANCE;
  }

  return 0;
}

export function isFullyWithdrawableValidator(fork: ForkSeq, validatorCredential: ValidatorCredential, balance: number, epoch: number) {
  const {withdrawableEpoch, withdrawalCredentials: withdrawalCredential} = validatorCredential;
  if (fork === ForkSeq.capella || fork === ForkSeq.deneb) {
    return hasEth1WithdrawalCredential(withdrawalCredential) && withdrawableEpoch <= epoch && balance > 0;
  }

  if (fork === ForkSeq.electra) {
    return (hasCompoundingWithdrawalCredential(withdrawalCredential) || hasEth1WithdrawalCredential(withdrawalCredential)) && withdrawableEpoch <= epoch && balance > 0;
  }

  return false;
}

export function isPartiallyWithdrawableValidator(fork: ForkSeq, validatorCredential: ValidatorCredential, balance: number, epoch: number) {
  const {effectiveBalance, withdrawalCredentials: withdrawalCredential} = validatorCredential;
  if (fork === ForkSeq.capella || fork === ForkSeq.deneb) {
    return hasEth1WithdrawalCredential(withdrawalCredential) && effectiveBalance === MAX_EFFECTIVE_BALANCE && balance > MAX_EFFECTIVE_BALANCE;
  }

  if (fork === ForkSeq.electra) {
    return (hasCompoundingWithdrawalCredential(withdrawalCredential) || hasEth1WithdrawalCredential(withdrawalCredential)) && getValidatorExcessBalance(withdrawalCredential, balance) > 0;
  }

  return false;
}