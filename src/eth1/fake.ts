import BN from "bn.js";
import {Deposit, DepositData, Eth1Data, number64} from "../types";
import {EMPTY_SIGNATURE} from "../constants";
import {intDiv} from "../util/math";


interface DummyChainStart {
  deposits: Deposit[];
  genesisTime: number64;
  eth1Data: Eth1Data;
}

function generateEthData(): Eth1Data {
  return {
    blockHash: Buffer.alloc(32),
    depositRoot: Buffer.alloc(32),
    depositCount: 0,
  };
}

function generateFakeDeposits(): Deposit[] {
  const deposits: Deposit[] = [];

  for (let i = 0; i < 10; i++) {
    const data: DepositData = {
      pubkey: Buffer.alloc(48),
      withdrawalCredentials: Buffer.alloc(32),
      amount: new BN(32).mul(new BN(10).muln(9)), // 32000000000
      signature: EMPTY_SIGNATURE,
    };

    const deposit: Deposit = {
      proof: [Buffer.alloc(32)],
      data,
      index: i,
    };
    deposits.push(deposit);
  }
  return deposits;
}

export function getInitialDeposits(): DummyChainStart {
  return {
    deposits: generateFakeDeposits(),
    eth1Data: generateEthData(),
    genesisTime: intDiv(Date.now(), 1000),
  };
}


