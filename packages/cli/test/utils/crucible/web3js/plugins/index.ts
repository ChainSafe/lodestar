import {Web3} from "web3";
import {Web3AdminPlugin} from "./web3AdminPlugin.js";
import {Web3ExtendedEthPlugin} from "./web3ExtendedEthPlugin.js";

export function registerWeb3JsPlugins(web3: Web3): void {
  web3.registerPlugin(new Web3AdminPlugin());
  web3.registerPlugin(new Web3ExtendedEthPlugin());
}
