import Web3 from "web3";
import {Logger} from "@lodestar/utils";
import {createVerifiedExecutionProvider, LCTransport} from "./index.js";

const web3 = new Web3("https://lodestar-mainnetrpc.chainsafe.io");
const {provider} = createVerifiedExecutionProvider(
  new Web3.providers.HttpProvider("https://lodestar-mainnetrpc.chainsafe.io"),
  {
    transport: LCTransport.Rest,
    urls: ["https://lodestar-mainnet.chainsafe.io"],
    network: "mainnet",
    logger: console as unknown as Logger,
  }
);
const web3Verified = new Web3(provider);
const abi = [
  {
    constant: true,
    inputs: [],
    name: "name",
    outputs: [{name: "", type: "string"}],
    payable: false,
    stateMutability: "view",
    type: "function",
    signature: "0x06fdde03",
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
    signature: "0x095ea7b3",
  },
  {
    constant: true,
    inputs: [],
    name: "totalSupply",
    outputs: [{name: "", type: "uint256"}],
    payable: false,
    stateMutability: "view",
    type: "function",
    signature: "0x18160ddd",
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
    signature: "0x23b872dd",
  },
  {
    constant: true,
    inputs: [],
    name: "decimals",
    outputs: [{name: "", type: "uint8"}],
    payable: false,
    stateMutability: "view",
    type: "function",
    signature: "0x313ce567",
  },
  {
    constant: true,
    inputs: [],
    name: "_totalSupply",
    outputs: [{name: "", type: "uint256"}],
    payable: false,
    stateMutability: "view",
    type: "function",
    signature: "0x3eaaf86b",
  },
  {
    constant: true,
    inputs: [{name: "tokenOwner", type: "address"}],
    name: "balanceOf",
    outputs: [{name: "balance", type: "uint256"}],
    payable: false,
    stateMutability: "view",
    type: "function",
    signature: "0x70a08231",
  },
  {
    constant: true,
    inputs: [],
    name: "symbol",
    outputs: [{name: "", type: "string"}],
    payable: false,
    stateMutability: "view",
    type: "function",
    signature: "0x95d89b41",
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
    signature: "0xa293d1e8",
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
    signature: "0xa9059cbb",
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
    signature: "0xb5931f7c",
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
    signature: "0xd05c78da",
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
    signature: "0xdd62ed3e",
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
    signature: "0xe6cb9013",
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
    signature: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
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
    signature: "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
  },
] as const;

const contract = new web3.eth.Contract(abi as never, "0xAde2a9c8b033D60FFCDB8CFc974DD87b2a9c1f27");
const contractVerified = new web3Verified.eth.Contract(abi as never, "0xAde2a9c8b033D60FFCDB8CFc974DD87b2a9c1f27");

console.log(await contract.methods.safeAdd(4, 5).call(), "From the standard RPC");
console.log(await contractVerified.methods.safeAdd(4, 5).call(), "From the verified RPC");
