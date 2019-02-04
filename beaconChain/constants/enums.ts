enum StatusFlag {
  INTIATED_EXIT = 2 ** 0,
  WITHDRAWABLE = 2 ** 1,
}

enum SignatureDomain {
  DOMAIN_DEPOSIT = 0,
  DOMAIN_ATTESTATION = 1,
  DOMAIN_PROPOSAL = 2,
  DOMAIN_EXIT = 3,
  DOMAIN_RANDAO = 4,
}

export {
  SignatureDomain,
  StatusFlag,
};
