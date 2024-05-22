import {Web3PluginBase} from "web3";

export class Web3ExtendedEthPlugin extends Web3PluginBase {
  pluginNamespace = "extended";

  async sendRawTransaction(tx: string): Promise<string> {
    return this.requestManager.send({method: "eth_sendRawTransaction", params: [tx]});
  }

  async sendPlainTransaction(...params: unknown[]): Promise<string> {
    return this.requestManager.send({method: "eth_sendTransaction", params: [...params]});
  }
}

declare module "web3" {
  interface Web3Context {
    extended: Web3ExtendedEthPlugin;
  }
}
