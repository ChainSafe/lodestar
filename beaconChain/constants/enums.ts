// https://github.com/ethereum/eth2.0-specs/blob/master/specs/core/0_beacon-chain.md#constants

enum ValidatorStatusCodes {
  PENDING_ACTIVATION = 0,
  ACTIVE = 1,
  ACTIVE_PENDING_EXIT = 2,
  EXITED_WITHOUT_PENALTY = 3,
  EXITED_WITH_PENALTY = 4,
}

enum ValidatorRegistryDeltaFlags {
  ACTIVATION = 0,
  EXIT = 1,
}

enum SignatureDomains {
  DOMAIN_DEPOSIT = 0,
  DOMAIN_ATTESTATION = 1,
  DOMAIN_PROPOSAL = 2,
  DOMAIN_EXIT = 3,
}

export {
  SignatureDomains,
  ValidatorRegistryDeltaFlags,
  ValidatorStatusCodes,
};
