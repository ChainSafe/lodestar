// https://github.com/ethereum/eth2.0-specs/blob/master/specs/core/0_beacon-chain.md#constants

enum ValidatorStatusCodes {
  PENDING_ACTIVATION = 0,
  ACTIVE = 1,
	PENDING_EXIT = 2,
	PENDING_WITHDRAW = 3,
  WITHDRAWN = 4,
  PENALIZED = 127,
}

enum SpecialRecordTypes {
	LOGOUT = 0,
	CASPER_SLASHING = 1,
	PROPOSER_SLASHING = 2,
	DEPOSIT_PROOF = 3,
}

enum ValidatorSetDeltaFlags {
	ENTRY = 0,
	EXIT = 1,
}

enum BLSDomains {
  DOMAIN_DEPOSIT = 0,
  DOMAIN_ATTESTATION = 1,
  DOMAIN_PROPOSAL = 2,
  DOMAIN_LOGOUT = 3
}

export default {
  ValidatorStatusCodes,
  SpecialRecordTypes,
  ValidatorSetDeltaFlags,
  BLSDomains,
}
