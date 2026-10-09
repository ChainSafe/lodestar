import {SIM_ENV_CHAIN_ID, SIM_ENV_NETWORK_ID} from "../constants.js";
import {Eth1GenesisBlock, ExecutionGenesisOptions} from "../interfaces.js";

// Prague system contracts, EL clients reject payload building if these have no code
const SYSTEM_CONTRACTS_ALLOC = {
  // EIP-4788
  "0x000f3df6d732807ef1319fb7b8bb8522d0beac02": {
    balance: "0x0",
    nonce: "0x1",
    code: "0x3373fffffffffffffffffffffffffffffffffffffffe14604d57602036146024575f5ffd5b5f35801560495762001fff810690815414603c575f5ffd5b62001fff01545f5260205ff35b5f5ffd5b62001fff42064281555f359062001fff015500",
  },
  // EIP-2935
  "0x0000f90827f1c53a10cb7a02335b175320002935": {
    balance: "0x0",
    nonce: "0x1",
    code: "0x3373fffffffffffffffffffffffffffffffffffffffe14604657602036036042575f35600143038111604257611fff81430311604257611fff9006545f5260205ff35b5f5ffd5b5f35611fff60014303065500",
  },
  // EIP-7002
  "0x00000961ef480eb55e80d19ad83579a64c007002": {
    balance: "0x0",
    nonce: "0x1",
    code: "0x3373fffffffffffffffffffffffffffffffffffffffe1460cb5760115f54807fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff146101f457600182026001905f5b5f82111560685781019083028483029004916001019190604d565b909390049250505036603814608857366101f457346101f4575f5260205ff35b34106101f457600154600101600155600354806003026004013381556001015f35815560010160203590553360601b5f5260385f601437604c5fa0600101600355005b6003546002548082038060101160df575060105b5f5b8181146101835782810160030260040181604c02815460601b8152601401816001015481526020019060020154807fffffffffffffffffffffffffffffffff00000000000000000000000000000000168252906010019060401c908160381c81600701538160301c81600601538160281c81600501538160201c81600401538160181c81600301538160101c81600201538160081c81600101535360010160e1565b910180921461019557906002556101a0565b90505f6002555f6003555b5f54807fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff14156101cd57505f5b6001546002828201116101e25750505f6101e8565b01600290035b5f555f600155604c025ff35b5f5ffd",
  },
  // EIP-7251
  "0x0000bbddc7ce488642fb579f8b00f3a590007251": {
    balance: "0x0",
    nonce: "0x1",
    code: "0x3373fffffffffffffffffffffffffffffffffffffffe1460d35760115f54807fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff1461019a57600182026001905f5b5f82111560685781019083028483029004916001019190604d565b9093900492505050366060146088573661019a573461019a575f5260205ff35b341061019a57600154600101600155600354806004026004013381556001015f358155600101602035815560010160403590553360601b5f5260605f60143760745fa0600101600355005b6003546002548082038060021160e7575060025b5f5b8181146101295782810160040260040181607402815460601b815260140181600101548152602001816002015481526020019060030154905260010160e9565b910180921461013b5790600255610146565b90505f6002555f6003555b5f54807fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff141561017357505f5b6001546001828201116101885750505f61018e565b01600190035b5f555f6001556074025ff35b5f5ffd",
  },
};

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
      ...SYSTEM_CONTRACTS_ALLOC,
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

export const getNethermindChainSpec = (options: ExecutionGenesisOptions): Record<string, unknown> => {
  const {ttd, shanghaiTime, cancunTime, pragueTime} = options;
  const genesis = getGethGenesisBlock(options) as Eth1GenesisBlock;

  return {
    name: "simulation-dev",
    dataDir: "goerli",
    engine: {clique: {params: genesis.config.clique}},
    params: {
      accountStartNonce: "0x0",
      chainID: SIM_ENV_CHAIN_ID,
      networkID: SIM_ENV_NETWORK_ID,
      eip140Transition: "0x0",
      eip145Transition: "0x0",
      eip150Transition: "0x0",
      eip155Transition: "0x0",
      eip160Transition: "0x0",
      eip161abcTransition: "0x0",
      eip161dTransition: "0x0",
      eip211Transition: "0x0",
      eip214Transition: "0x0",
      eip658Transition: "0x0",
      eip1014Transition: "0x0",
      eip1052Transition: "0x0",
      eip1283Transition: "0x0",
      eip1283DisableTransition: "0x0",
      eip152Transition: "0x0",
      eip1108Transition: "0x0",
      eip1344Transition: "0x0",
      eip1884Transition: "0x0",
      eip2028Transition: "0x0",
      eip2200Transition: "0x0",
      eip2565Transition: "0x0",
      eip2929Transition: "0x0",
      eip2930Transition: "0x0",
      eip1559Transition: "0x0",
      eip3198Transition: "0x0",
      eip3529Transition: "0x0",
      eip3541Transition: "0x0",
      terminalTotalDifficulty: Number(ttd as bigint),
      gasLimitBoundDivisor: "0x400",
      maxCodeSize: "0x6000",
      maxCodeSizeTransition: "0x0",
      maximumExtraDataSize: "0xfff",
      minGasLimit: "0x0",
      eip4895TransitionTimestamp: `0x${shanghaiTime.toString(16)}`,
      eip3855TransitionTimestamp: `0x${shanghaiTime.toString(16)}`,
      eip3651TransitionTimestamp: `0x${shanghaiTime.toString(16)}`,
      eip3860TransitionTimestamp: `0x${shanghaiTime.toString(16)}`,
      eip1153TransitionTimestamp: `0x${cancunTime.toString(16)}`,
      eip4788TransitionTimestamp: `0x${cancunTime.toString(16)}`,
      eip4844TransitionTimestamp: `0x${cancunTime.toString(16)}`,
      eip5656TransitionTimestamp: `0x${cancunTime.toString(16)}`,
      eip6780TransitionTimestamp: `0x${cancunTime.toString(16)}`,
      eip2537TransitionTimestamp: `0x${pragueTime.toString(16)}`,
      eip2935TransitionTimestamp: `0x${pragueTime.toString(16)}`,
      eip6110TransitionTimestamp: `0x${pragueTime.toString(16)}`,
      eip7002TransitionTimestamp: `0x${pragueTime.toString(16)}`,
      eip7251TransitionTimestamp: `0x${pragueTime.toString(16)}`,
      eip7623TransitionTimestamp: `0x${pragueTime.toString(16)}`,
      eip7702TransitionTimestamp: `0x${pragueTime.toString(16)}`,
      depositContractAddress: "0x1234567890123456789012345678901234567890",
      blobSchedule: [
        {
          name: "cancun",
          timestamp: `0x${cancunTime.toString(16)}`,
          target: 3,
          max: 6,
          baseFeeUpdateFraction: "0x32f0ed",
        },
        {
          name: "prague",
          timestamp: `0x${pragueTime.toString(16)}`,
          target: 6,
          max: 9,
          baseFeeUpdateFraction: "0x4c6964",
        },
      ],
    },
    accounts: genesis.alloc,
    genesis: genesis,
  };
};
