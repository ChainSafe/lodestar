import Web3 from "web3";
import {LightNode} from "./interfaces.js";
import {makeProvableProvider} from "./web3_provider.js";

const provider = new Web3.providers.HttpProvider("https://lodestar-sepoliarpc.chainsafe.io");
const proveableProvider = makeProvableProvider(provider, {
  mode: LightNode.Rest,
  urls: ["https://lodestar-sepolia.chainsafe.io"],
  network: "sepolia",
});

await proveableProvider.rootProvider.sync();

console.log(proveableProvider.rootProvider.getStatus());

const web3 = new Web3(proveableProvider);

const address = "0x8EB8a3b98659Cce290402893d0123abb75E3ab28";
const balance = await web3.eth.getBalance(address, "latest");
console.log({balance, address});
