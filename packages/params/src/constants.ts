export const GENESIS_SLOT = 0;
export const GENESIS_EPOCH = 0;
export const FAR_FUTURE_EPOCH = Infinity;
export const BASE_REWARDS_PER_EPOCH = 4;
export const DEPOSIT_CONTRACT_TREE_DEPTH = 32;
export const JUSTIFICATION_BITS_LENGTH = 4;

//TODO: use ssz to calculate Path(BeaconState)/'finalized_checkpoint'/'root'
export const FINALIZED_ROOT_INDEX = 105;
//TODO: use ssz to calculate Path(BeaconState)/'next_sync_committee'
export const NEXT_SYNC_COMMITTEE_INDEX = 54;
// BigInt(2 ** 64) - BigInt(1);
export const MAX_VALID_LIGHT_CLIENT_UPDATES = Number.MAX_SAFE_INTEGER;
export const MIN_SYNC_COMMITTEE_PARTICIPANTS = 1;
//~27 hours
export const LIGHT_CLIENT_UPDATE_TIMEOUT = 2 ** 13;
