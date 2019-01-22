// https://github.com/ethereum/eth2.0-specs/blob/master/specs/core/0_beacon-chain.md#constants

enum StatusFlags {
  INTIATED_EXIT = 2 ** 0,
  WITHDRAWABLE = 2 ** 1,
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
  StatusFlags,
};
