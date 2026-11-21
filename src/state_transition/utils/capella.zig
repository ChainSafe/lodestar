const c = @import("constants");
const types = @import("consensus_types");
const ETH1_ADDRESS_WITHDRAWAL_PREFIX = c.ETH1_ADDRESS_WITHDRAWAL_PREFIX;

pub const WithdrawalCredentials = types.primitive.Root.Type;

/// https://github.com/ethereum/consensus-specs/blob/3d235740e5f1e641d3b160c8688f26e7dc5a1894/specs/capella/beacon-chain.md#has_eth1_withdrawal_credential
pub fn hasEth1WithdrawalCredential(withdrawal_credentials: *const WithdrawalCredentials) bool {
    return withdrawal_credentials[0] == ETH1_ADDRESS_WITHDRAWAL_PREFIX;
}
