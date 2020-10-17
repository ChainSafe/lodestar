import {IBeaconParams} from "@chainsafe/lodestar-params";
import {fromHexString} from "@chainsafe/ssz";

/* eslint-disable max-len */

export const beaconParams: Partial<IBeaconParams> = {
  DEPOSIT_CHAIN_ID: 5,
  DEPOSIT_NETWORK_ID: 5,
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 1024,
  MIN_GENESIS_TIME: 1602504000,
  DEPOSIT_CONTRACT_ADDRESS: Buffer.from(fromHexString("0x99F0Ec06548b086E46Cb0019C78D0b9b9F36cD53")),
  GENESIS_FORK_VERSION: Buffer.from(fromHexString("0x00000003")),
  GENESIS_DELAY: 345600,
};

export const depositContractDeployBlock = 3488417;
export const genesisFileUrl = null;
export const bootnodesFileUrl = "https://github.com/goerli/medalla/raw/master/zinken/bootnodes.txt";

export const bootEnrs = [
  "enr:-KG4QHPtVnKHEOkEJT1f5C6Hs-C_c4SlipTfkPrDIikLTzhqA_3m6bTq-CirsljlVP4IJybXelHE7J3l9DojR14_ZHUGhGV0aDKQ2jUIggAAAAP__________4JpZIJ2NIJpcIQSv2qciXNlY3AyNTZrMaECi_CNPDkKPilhimY7aEY-mBtSzI8AKMDvvv_I2Un74_qDdGNwgiMog3VkcIIjKA",
  "enr:-Ku4QH63huZ12miIY0kLI9dunG5fwKpnn-zR3XyA_kH6rQpRD1VoyLyzIcFysCJ09JDprdX-EzXp-Nc8swYqBznkXggBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpDaNQiCAAAAA___________gmlkgnY0gmlwhBLf22SJc2VjcDI1NmsxoQILqxBY-_SF8o_5FjFD3yM92s50zT_ciFi8hStde5AEjIN1ZHCCH0A",
  "enr:-Ku4QMGGAuQO8NPhYCz29wsahrFR-betfxKx6ltyzLUM70yJWoaRjJZ-n1Oiof2PiKnzjVG1n6RoyO4ZNJkQtqEkqNkBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpDaNQiCAAAAA___________gmlkgnY0gmlwhDZUyU6Jc2VjcDI1NmsxoQNMOowBnXeUYjK71_Zz78j3y7EYKSXH9ZGhYB4wB6V8lIN1ZHCCIyg",
];
