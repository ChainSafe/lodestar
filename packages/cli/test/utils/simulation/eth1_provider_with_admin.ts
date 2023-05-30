/* eslint-disable @typescript-eslint/naming-convention */
import {Eth1Provider} from "@lodestar/beacon-node";
import {JsonRpcHttpClient} from "@lodestar/beacon-node/eth1/provider/jsonRpcHttpClient";

interface EthJsonRpcAdminReturnTypes {
  admin_nodeInfo: {
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
  };
  admin_addPeer: boolean;
}

export class Eth1ProviderWithAdmin extends Eth1Provider {
  getRpc(): JsonRpcHttpClient {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return this["rpc"];
  }

  admin = {
    nodeInfo: async (): Promise<EthJsonRpcAdminReturnTypes["admin_nodeInfo"]> => {
      const method = "admin_nodeInfo";

      return this.getRpc().fetch<EthJsonRpcAdminReturnTypes[typeof method]>(
        // false = include only transaction roots, not full objects
        {method, params: []}
      );
    },

    addPeer: async (enode: string): Promise<EthJsonRpcAdminReturnTypes["admin_addPeer"]> => {
      const method = "admin_addPeer";

      return this.getRpc().fetch<EthJsonRpcAdminReturnTypes[typeof method]>(
        // false = include only transaction roots, not full objects
        {method, params: [enode]}
      );
    },
  };
}
