import {SIM_ENV_CHAIN_ID, SIM_ENV_NETWORK_ID} from "../constants.js";
import {ELGeneratorGenesisOptions, ELStartMode, Eth1GenesisBlock} from "../interfaces.js";

export const getGethGenesisBlock = (mode: ELStartMode, options: ELGeneratorGenesisOptions): Record<string, unknown> => {
  const {ttd, cliqueSealingPeriod} = options;

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
      terminalTotalDifficulty: Number(ttd as bigint),
      clique: {period: cliqueSealingPeriod, epoch: 30000},
    },
    nonce: "0x0",
    timestamp: "0x6159af19",
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

  if (mode === ELStartMode.PreMerge) {
    return genesis;
  }

  // TODO: Figure out PostMerge genesis later
  return genesis;
};

export const getNethermindChainSpec = (
  mode: ELStartMode,
  options: ELGeneratorGenesisOptions
): Record<string, unknown> => {
  const {ttd} = options;
  const genesis = getGethGenesisBlock(mode, options) as Eth1GenesisBlock;

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
    },
    accounts: genesis.alloc,
    genesis: genesis,
  };
};
