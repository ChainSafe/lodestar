import {ETH1_ADDRESS_WITHDRAWAL_PREFIX} from "@lodestar/params";

/**
 * https://github.com/ethereum/consensus-specs/blob/v1.5.0-beta.5/specs/capella/beacon-chain.md#has_eth1_withdrawal_credential
 */
export function hasEth1WithdrawalCredential(withdrawalCredentials: Uint8Array): boolean {
  return withdrawalCredentials[0] === ETH1_ADDRESS_WITHDRAWAL_PREFIX;
}
