"use strict";
// https://github.com/ethereum/eth2.0-specs/blob/master/specs/core/0_beacon-chain.md#constants
Object.defineProperty(exports, "__esModule", { value: true });
var ValidatorStatusCodes;
(function (ValidatorStatusCodes) {
    ValidatorStatusCodes[ValidatorStatusCodes["PENDING_ACTIVATION"] = 0] = "PENDING_ACTIVATION";
    ValidatorStatusCodes[ValidatorStatusCodes["ACTIVE"] = 1] = "ACTIVE";
    ValidatorStatusCodes[ValidatorStatusCodes["ACTIVE_PENDING_EXIT"] = 2] = "ACTIVE_PENDING_EXIT";
    ValidatorStatusCodes[ValidatorStatusCodes["EXITED_WITHOUT_PENALTY"] = 3] = "EXITED_WITHOUT_PENALTY";
    ValidatorStatusCodes[ValidatorStatusCodes["EXITED_WITH_PENALTY"] = 4] = "EXITED_WITH_PENALTY";
})(ValidatorStatusCodes || (ValidatorStatusCodes = {}));
exports.ValidatorStatusCodes = ValidatorStatusCodes;
var ValidatorRegistryDeltaFlags;
(function (ValidatorRegistryDeltaFlags) {
    ValidatorRegistryDeltaFlags[ValidatorRegistryDeltaFlags["ACTIVATION"] = 0] = "ACTIVATION";
    ValidatorRegistryDeltaFlags[ValidatorRegistryDeltaFlags["EXIT"] = 1] = "EXIT";
})(ValidatorRegistryDeltaFlags || (ValidatorRegistryDeltaFlags = {}));
exports.ValidatorRegistryDeltaFlags = ValidatorRegistryDeltaFlags;
var SignatureDomains;
(function (SignatureDomains) {
    SignatureDomains[SignatureDomains["DOMAIN_DEPOSIT"] = 0] = "DOMAIN_DEPOSIT";
    SignatureDomains[SignatureDomains["DOMAIN_ATTESTATION"] = 1] = "DOMAIN_ATTESTATION";
    SignatureDomains[SignatureDomains["DOMAIN_PROPOSAL"] = 2] = "DOMAIN_PROPOSAL";
    SignatureDomains[SignatureDomains["DOMAIN_EXIT"] = 3] = "DOMAIN_EXIT";
})(SignatureDomains || (SignatureDomains = {}));
exports.SignatureDomains = SignatureDomains;
//# sourceMappingURL=enums.js.map