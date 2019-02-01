enum StatusFlags {
  INTIATED_EXIT = 2 ** 0,
  WITHDRAWABLE = 2 ** 1,
}

enum SignatureDomains {
  DOMAIN_DEPOSIT = 0,
  DOMAIN_ATTESTATION = 1,
  DOMAIN_PROPOSAL = 2,
  DOMAIN_EXIT = 3,
  DOMAIN_RANDAO = 4,
}

export {
  SignatureDomains,
  StatusFlags,
};
