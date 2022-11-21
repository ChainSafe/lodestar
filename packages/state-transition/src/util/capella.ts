import {ETH1_ADDRESS_WITHDRAWAL_PREFIX} from "@lodestar/params";

/**
 * https://github.com/ethereum/consensus-specs/blob/3d235740e5f1e641d3b160c8688f26e7dc5a1894/specs/capella/beacon-chain.md#has_eth1_withdrawal_credential
 */
export function hasEth1WithdrawalCredential(withdrawalCredentials: Uint8Array): boolean {
  return withdrawalCredentials[0] === ETH1_ADDRESS_WITHDRAWAL_PREFIX;
}
