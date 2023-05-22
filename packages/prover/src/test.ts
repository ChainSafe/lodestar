import Web3 from "web3";
import {LogLevel} from "@lodestar/utils";
import {createVerifiedExecutionProvider} from "./web3_provider.js";
import {LCTransport} from "./interfaces.js";

const abi = [
  {
    constant: true,
    inputs: [],
    name: "name",
    outputs: [{name: "", type: "string"}],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      {name: "spender", type: "address"},
      {name: "tokens", type: "uint256"},
    ],
    name: "approve",
    outputs: [{name: "success", type: "bool"}],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "totalSupply",
    outputs: [{name: "", type: "uint256"}],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      {name: "from", type: "address"},
      {name: "to", type: "address"},
      {name: "tokens", type: "uint256"},
    ],
    name: "transferFrom",
    outputs: [{name: "success", type: "bool"}],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "decimals",
    outputs: [{name: "", type: "uint8"}],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "_totalSupply",
    outputs: [{name: "", type: "uint256"}],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [{name: "tokenOwner", type: "address"}],
    name: "balanceOf",
    outputs: [{name: "balance", type: "uint256"}],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "symbol",
    outputs: [{name: "", type: "string"}],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [
      {name: "a", type: "uint256"},
      {name: "b", type: "uint256"},
    ],
    name: "safeSub",
    outputs: [{name: "c", type: "uint256"}],
    payable: false,
    stateMutability: "pure",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      {name: "to", type: "address"},
      {name: "tokens", type: "uint256"},
    ],
    name: "transfer",
    outputs: [{name: "success", type: "bool"}],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: true,
    inputs: [
      {name: "a", type: "uint256"},
      {name: "b", type: "uint256"},
    ],
    name: "safeDiv",
    outputs: [{name: "c", type: "uint256"}],
    payable: false,
    stateMutability: "pure",
    type: "function",
  },
  {
    constant: true,
    inputs: [
      {name: "a", type: "uint256"},
      {name: "b", type: "uint256"},
    ],
    name: "safeMul",
    outputs: [{name: "c", type: "uint256"}],
    payable: false,
    stateMutability: "pure",
    type: "function",
  },
  {
    constant: true,
    inputs: [
      {name: "tokenOwner", type: "address"},
      {name: "spender", type: "address"},
    ],
    name: "allowance",
    outputs: [{name: "remaining", type: "uint256"}],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [
      {name: "a", type: "uint256"},
      {name: "b", type: "uint256"},
    ],
    name: "safeAdd",
    outputs: [{name: "c", type: "uint256"}],
    payable: false,
    stateMutability: "pure",
    type: "function",
  },
  {inputs: [], payable: false, stateMutability: "nonpayable", type: "constructor"},
  {
    anonymous: false,
    inputs: [
      {indexed: true, name: "from", type: "address"},
      {indexed: true, name: "to", type: "address"},
      {indexed: false, name: "tokens", type: "uint256"},
    ],
    name: "Transfer",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {indexed: true, name: "tokenOwner", type: "address"},
      {indexed: true, name: "spender", type: "address"},
      {indexed: false, name: "tokens", type: "uint256"},
    ],
    name: "Approval",
    type: "event",
  },
] as const;

const {provider} = createVerifiedExecutionProvider(
  new Web3.providers.HttpProvider("https://lodestar-mainnetrpc.chainsafe.io"),
  {
    network: "mainnet",
    logLevel: LogLevel.debug,
    transport: LCTransport.Rest,
    urls: ["https://lodestar-mainnet.chainsafe.io"],
  }
);
// const provider = new Web3.providers.HttpProvider("https://lodestar-mainnetrpc.chainsafe.io");
const web3 = new Web3(provider);

const contract = new web3.eth.Contract(abi as any, "0xAde2a9c8b033D60FFCDB8CFc974DD87b2a9c1f27");

console.log(await contract.methods.safeMul(9999786123, 888887689087).estimateGas());

// console.log(
//   await web3.eth.estimateGas({
//     from: "0x690B9A9E9aa1C9dB991C7721a92d351Db4FaC990",
//     to: "0x388c818ca8b9251b393131c08a736a67ccb19297",
//     value: "0xFF00900",
//   })
// );
