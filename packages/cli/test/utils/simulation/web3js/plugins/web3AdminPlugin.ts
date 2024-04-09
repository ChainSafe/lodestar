import {Web3PluginBase} from "web3";

export class Web3AdminPlugin extends Web3PluginBase {
  /**
   * The admin plugin as available via the provider object
   * like in the example below.
   *
   * await node.web3.admin.addPeer(elIdentity.enode);
   */
  pluginNamespace = "admin";

  async nodeInfo(): Promise<{
    enode: string;
    id: string;
    ip: string;
    listenAddr: string;
    name: string;
    ports: {
      discovery: number;
      listener: number;
    };
    protocols: {
      eth: {
        difficulty: number;
        genesis: string;
        head: string;
        network: number;
      };
    };
  }> {
    return this.requestManager.send({method: "admin_nodeInfo", params: []});
  }

  async addPeer(enode: string): Promise<boolean> {
    return this.requestManager.send({method: "admin_addPeer", params: [enode]});
  }
}

declare module "web3" {
  interface Web3Context {
    admin: Web3AdminPlugin;
  }
}
