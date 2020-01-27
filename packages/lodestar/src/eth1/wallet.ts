/**
 * @module eth1
 */

import {ContractTransaction, ethers, Wallet} from "ethers";
import {Provider} from "ethers/providers";
import {BigNumber, ParamType} from "ethers/utils";
import bls, {PrivateKey} from "@chainsafe/bls";
import {hash, signingRoot} from "@chainsafe/ssz";
import {DepositData} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {DomainType} from "../constants";
import {ILogger} from  "@chainsafe/eth2.0-utils/lib/logger";


export class Eth1Wallet {

  private wallet: Wallet;

  private contractAbi: string|ParamType[];

  private config: IBeaconConfig;

  private logger: ILogger;

  public constructor(
    eth1PrivateKey: string,
    contractAbi: string|ParamType[],
    config: IBeaconConfig,
    logger: ILogger,
    provider?: Provider,
  ) {
    this.config = config;
    this.logger = logger;
    if(!provider) {
      provider = ethers.getDefaultProvider();
    }
    this.wallet = new Wallet(eth1PrivateKey, provider);
    this.contractAbi = contractAbi;
  }

  /**
   * Will deposit 32 ETH to eth2.0 deposit contract.
   * @param address address of deposit contract
   * @param value amount to wei to deposit on contract
   */

  public async submitValidatorDeposit(address: string, value: BigNumber, signingKey: PrivateKey, withdrawalKey: PrivateKey): Promise<string> {
    const amount = BigInt(value.toString()) / 1000000000n;

    const contract = new ethers.Contract(address, this.contractAbi, this.wallet);
    const pubkey = signingKey.toPublicKey().toBytesCompressed();
    const withdrawalCredentials = Buffer.concat([
      this.config.params.BLS_WITHDRAWAL_PREFIX_BYTE,
      hash(withdrawalKey.toPublicKey().toBytesCompressed()).slice(1),
    ]);

    // Create deposit data
    const depositData: DepositData = {
      pubkey,
      withdrawalCredentials,
      amount,
      signature: Buffer.alloc(96)
    };

    depositData.signature = bls.sign(
      signingKey.toBytes(),
      signingRoot(this.config.types.DepositData, depositData),
      Buffer.from([0, 0, 0, DomainType.DEPOSIT])
    );
    // Send TX
    const tx: ContractTransaction = await contract.deposit(
      pubkey,
      withdrawalCredentials,
      depositData.signature,
      {value}
    );
    await tx.wait();
    return tx.hash || "";
  }

}
