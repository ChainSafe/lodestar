import {SIM_ENV_CHAIN_ID} from "../constants.js";
import {ExecutionGenesisOptions} from "../interfaces.js";

export const getGethGenesisBlock = (options: ExecutionGenesisOptions): Record<string, unknown> => {
  const {ttd, cliqueSealingPeriod, shanghaiTime, genesisTime, cancunTime, pragueTime} = options;

  const genesis = {
    config: {
      chainId: SIM_ENV_CHAIN_ID,
      homesteadBlock: 0,
      daoForkSupport: true,
      eip150Block: 0,
      eip150Hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      eip155Block: 0,
      eip158Block: 0,
      byzantiumBlock: 0,
      constantinopleBlock: 0,
      petersburgBlock: 0,
      istanbulBlock: 0,
      muirGlacierBlock: 0,
      berlinBlock: 0,
      londonBlock: 0,
      shanghaiTime,
      cancunTime,
      pragueTime,
      blobSchedule: {
        cancun: {
          target: 3,
          max: 6,
          baseFeeUpdateFraction: 3338477,
        },
        prague: {target: 6, max: 9, baseFeeUpdateFraction: 5007716},
        // "osaka":  { "target": 6, "max": 9, "updateFraction": 5007716 }
      },
      terminalTotalDifficulty: Number(ttd as bigint),
      clique: {period: cliqueSealingPeriod, epoch: 30000},
    },
    nonce: "0x0",
    timestamp: `0x${genesisTime.toString(16)}`,
    extraData:
      "0x0000000000000000000000000000000000000000000000000000000000000000a94f5374fce5edbc8e2a8697c15331677e6ebf0b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    gasLimit: "0x1c9c380",
    difficulty: "0x0",
    mixHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    coinbase: "0x0000000000000000000000000000000000000000",
    seal: {
      ethereum: {
        nonce: "0x0000000000000000",
        mixHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
    alloc: {
      "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b": {
        balance: "0x6d6172697573766477000000",
      },
    },
    number: "0x0",
    gasUsed: "0x0",
    parentHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    baseFeePerGas: "0x0",
  };

  return genesis;
};
