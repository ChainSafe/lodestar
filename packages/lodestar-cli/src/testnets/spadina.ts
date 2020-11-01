import {IBeaconParamsUnparsed} from "../config/types";

/* eslint-disable max-len */

export const beaconParams: IBeaconParamsUnparsed = {
  DEPOSIT_CHAIN_ID: 5,
  DEPOSIT_NETWORK_ID: 5,
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 1024,
  MIN_GENESIS_TIME: 1601380800,
  DEPOSIT_CONTRACT_ADDRESS: "0x48B597F4b53C21B48AD95c7256B49D1779Bd5890",
  GENESIS_FORK_VERSION: "0x00000002",
};

export const depositContractDeployBlock = 3384340;
export const genesisFileUrl = null;
export const bootnodesFileUrl = "https://github.com/goerli/medalla/raw/master/spadina/bootnodes.txt";

export const bootEnrs = [
  "enr:-KG4QA-EcFfXQsL2dcneG8vp8HTWLrpwHQ5HhfyIytfpeKOISzROy2kYSsf_v-BZKnIx5XHDjqJ-ttz0hoz6qJA7tasEhGV0aDKQxKgkDQAAAAL__________4JpZIJ2NIJpcIQDFt-UiXNlY3AyNTZrMaECkR4C5DVO_9rB48eHTY4kdyOHsguTEDlvb7Ce0_mvghSDdGNwgiMog3VkcIIjKA",
  "enr:-Ku4QGQJf2bcDAwVGvbvtq3AB4KKwAvStTenY-i_QnW2ABNRRBncIU_5qR_e_um-9t3s9g-Y5ZfFATj1nhtzq6lvgc4Bh2F0dG5ldHOIAAAAAAAAAACEZXRoMpDEqCQNAAAAAv__________gmlkgnY0gmlwhBLf22SJc2VjcDI1NmsxoQNoed9JnQh7ltcAacHEGOjwocL1BhMQbYTgaPX0kFuXtIN1ZHCCE4g",
  "enr:-Iu4QNDgG2jO9kRZcG9SujeKpUASYjZc9kz9DscOd50toIStLe3QiR2iYHTRsfkaVhDQCy7KJ-we3Cwj9Mw17CRZSMsCgmlkgnY0gmlwhDQQKNaJc2VjcDI1NmsxoQMJq90LfuVvZ-AGAqu-stFn5m8vokU15QcdzlNdn8FiqYN0Y3CCIyiDdWRwgiMo",
  "enr:-Ku4QFW1SLbtzJ_ghQQC8-8xezvZ1Mx95J-zer9IPmDE2BKeD_SM7j4vH6xmroUFVuyK-54n2Ey2ueB-Lf-fkbcLwAQBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpDEqCQNAAAAAv__________gmlkgnY0gmlwhGQZkSyJc2VjcDI1NmsxoQJMcbZhTCEKYSH5-qPQPgYfSHHUMLGBAKU-f-96yYKFMIN1ZHCCIyg",
];
