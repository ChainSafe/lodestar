/**
 * @module eth1
 */

import {ContractTransaction, ethers, Wallet} from "ethers";
import bls, {PrivateKey} from "@chainsafe/bls";
import {hash} from "@chainsafe/ssz";
import {DepositData} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {DomainType} from "../constants";
import {IEthersAbi} from "./interface";
import {computeSigningRoot, computeDomain} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";


export class Eth1Wallet {

  private wallet: Wallet;

  private contractAbi: IEthersAbi;

  private config: IBeaconConfig;

  private logger: ILogger;

  public constructor(
    eth1PrivateKey: string,
    contractAbi: IEthersAbi,
    config: IBeaconConfig,
    logger: ILogger,
    provider?: ethers.providers.Provider,
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

  public async submitValidatorDeposit(
    address: string, 
    value: ethers.BigNumber, 
    signingKey: PrivateKey, 
    withdrawalKey: PrivateKey
  ): Promise<string> {
    const amount = BigInt(value.toString()) / 1000000000n;

    const contract = new ethers.Contract(address, this.contractAbi, this.wallet);
    const pubkey = signingKey.toPublicKey().toBytesCompressed();
    const withdrawalCredentials = Buffer.concat([
      this.config.params.BLS_WITHDRAWAL_PREFIX,
      hash(withdrawalKey.toPublicKey().toBytesCompressed()).slice(1),
    ]);

    // Create deposit data
    const depositData: DepositData = {
      pubkey,
      withdrawalCredentials,
      amount,
      signature: Buffer.alloc(96)
    };

    const domain = computeDomain(this.config, DomainType.DEPOSIT);
    const signingroot = computeSigningRoot(this.config, this.config.types.DepositMessage, depositData, domain);
    depositData.signature = bls.sign(
      signingKey.toBytes(),
      signingroot
    );

    const depositDataRoot = this.config.types.DepositData.hashTreeRoot(depositData);

    // Send TX
    const tx: ContractTransaction = await contract.deposit(
      pubkey,
      withdrawalCredentials,
      depositData.signature,
      depositDataRoot,
      {value}
    );
    await tx.wait();
    return tx.hash || "";
  }

}
