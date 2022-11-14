import {JsonRpcProvider} from "@ethersproject/providers";
import {toBuffer, keccak256} from "ethereumjs-util";
import {DefaultStateManager} from "@ethereumjs/statemanager";
import {toHexString} from "@chainsafe/ssz";
import {IRootResolver} from "./rootResolver.js";

const externalAddressStorageHash = "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421";
const externalAddressCodeHash = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";

/** (optional) Integer (hex) block number, or the string 'latest', 'earliest' or 'pending' */
type QuantityOrTag = number | string | undefined;

export class LightclientRestProvider extends JsonRpcProvider {
  private readonly stateManager = new DefaultStateManager();

  constructor(private readonly rootResolver: IRootResolver) {
    super();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send(method: string, params: Array<any>): Promise<any> {
    switch (method) {
      case "eth_getBalance":
        return this.getBalanceWithProof(params as [string, QuantityOrTag]);

      default:
        return super.send(method, params);
    }
  }

  private async getBalanceWithProof(params: [string, QuantityOrTag]): Promise<number> {
    const address = params[0] as string;
    const quantityOrTag = params[1] as QuantityOrTag;

    // eth_getBalance 2nd argument is quantityOrTag
    // eth_getProof 3rd argument is same, to match against a known
    const header = this.rootResolver.resolveQuantityOrTag(quantityOrTag);

    // DATA, 20 bytes - address of the account or contract
    // ARRAY, 32 Bytes - array of storage-keys which should be proofed and included. See eth_getStorageAt
    // QUANTITY|TAG - integer block number, or the string "latest" or "earliest", see the default block parameter
    const proof = (await super.send("eth_getProof", [address, [], header.blockNumber])) as GetProofResult;

    const proofStateRoot = toHexString(keccak256(toBuffer(proof.accountProof[0])));

    const isValid =
      header.stateRoot === proofStateRoot &&
      (proof.codeHash !== externalAddressCodeHash || proof.storageHash === externalAddressStorageHash) &&
      (await this.stateManager.verifyProof(proof));

    if (!isValid) {
      throw Error(`Invalid proof for state blockNumber ${header.blockNumber}`);
    }

    return parseInt(proof.balance);
  }
}

interface GetProofResult {
  address: string;
  accountProof: string[];
  balance: string;
  codeHash: string;
  nonce: string;
  storageHash: string;
  storageProof: {
    key: string;
    value: string;
    proof: string[];
  }[];
}
