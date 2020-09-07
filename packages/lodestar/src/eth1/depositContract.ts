import {IEthersAbi} from "./interface";

export const depositContract: {abi: IEthersAbi; bytecode: string} = {
  // eslint-disable-next-line max-len
  // taken from https://raw.githubusercontent.com/ethereum/lodestar-specs/dev/deposit_contract/contracts/validator_registration.json
  // @ts-ignore
  // eslint-disable-next-line prettier/prettier
  // prettier-ignore
  // eslint-disable-next-line max-len
  abi: [{"name": "DepositEvent", "inputs": [{"type": "bytes", "name": "pubkey", "indexed": false}, {"type": "bytes", "name": "withdrawal_credentials", "indexed": false}, {"type": "bytes", "name": "amount", "indexed": false}, {"type": "bytes", "name": "signature", "indexed": false}, {"type": "bytes", "name": "index", "indexed": false}], "anonymous": false, "type": "event"}, {"outputs": [], "inputs": [], "constant": false, "payable": false, "type": "constructor"}, {"name": "get_deposit_root", "outputs": [{"type": "bytes32", "name": "out"}], "inputs": [], "constant": true, "payable": false, "type": "function", "gas": 95628}, {"name": "get_deposit_count", "outputs": [{"type": "bytes", "name": "out"}], "inputs": [], "constant": true, "payable": false, "type": "function", "gas": 18231}, {"name": "deposit", "outputs": [], "inputs": [{"type": "bytes", "name": "pubkey"}, {"type": "bytes", "name": "withdrawal_credentials"}, {"type": "bytes", "name": "signature"}, {"type": "bytes32", "name": "deposit_data_root"}], "constant": false, "payable": true, "type": "function", "gas": 1342274}]
};
