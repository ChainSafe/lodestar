import {phase0} from "@chainsafe/lodestar-types";
import {createIChainForkConfig, IChainForkConfig} from "@chainsafe/lodestar-config";
import {chainConfig} from "@chainsafe/lodestar-config/default";
import {goerliRpcUrl} from "../testParams";
import {fromHexString} from "@chainsafe/ssz";

/** Generic testnet data taken from the Medalla testnet  */
export const testnet = {
  providerUrl: goerliRpcUrl,
  depositBlock: 3085928,
  // Optimized blocks for quick testing
  blockWithDepositActivity: 3124889,
};

/** Testnet specs for the Medalla testnet */
export function getTestnetConfig(): IChainForkConfig {
  const config = createIChainForkConfig(chainConfig);
  config.DEPOSIT_NETWORK_ID = 5;
  config.DEPOSIT_CONTRACT_ADDRESS = Buffer.from("07b39F4fDE4A38bACe212b546dAc87C58DfE3fDC", "hex");
  config.MIN_GENESIS_TIME = 1596546000;
  config.GENESIS_DELAY = 172800;
  config.GENESIS_FORK_VERSION = Buffer.from("00000001", "hex");
  return config;
}

/** Goerli deposit log for the Medalla testnet */
export const goerliTestnetLogs = [
  {
    // Raw unparsed log index 6833
    blockNumber: 3124930,
    txHash: "0x9662b35ea4128fafe8185f8b4b0b890f72009d31e9d65a8f2ad5712f74910644",
    topics: ["0x649bbc62d0e31342afea4e5cd82d4049e7e1ee912fc0889aa790803be39038c5"],
    data:
      "0x00000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000180000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000308214eabc827a4deaed78c0bf3f91d81b57968041b5d7c975c716641ccfac7aa4e11e3354a357b1f40637e282fd66403500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000bb991061d2545c75e788b93f3425b03b05f0d2aae8e97da30d7d04886b9eb700000000000000000000000000000000000000000000000000000000000000080040597307000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006099cb82bc69b4111d1a828963f0316ec9aa38c4e9e041a8afec86cd20dfe9a590999845bf01d4689f3bbe3df54e48695e081f1216027b577c7fccf6ab0a4fcc75faf8009c6b55e518478139f604f542d138ae3bc34bad01ee6002006d64c4ff820000000000000000000000000000000000000000000000000000000000000008b11a000000000000000000000000000000000000000000000000000000000000",
  },
];

/** Goerli parsed deposit event for the Medalla testnet */
export const goerliTestnetDepositEvents: phase0.DepositEvent[] = [
  {
    blockNumber: 3124930,
    index: 6833,
    depositData: {
      pubkey: fromHexString(
        "8214EABC827A4DEAED78C0BF3F91D81B57968041B5D7C975C716641CCFAC7AA4E11E3354A357B1F40637E282FD664035"
      ),
      withdrawalCredentials: fromHexString("00BB991061D2545C75E788B93F3425B03B05F0D2AAE8E97DA30D7D04886B9EB7"),
      amount: 32e9,
      signature: fromHexString(
        "99CB82BC69B4111D1A828963F0316EC9AA38C4E9E041A8AFEC86CD20DFE9A590999845BF01D4689F3BBE3DF54E48695E081F1216027B577C7FCCF6AB0A4FCC75FAF8009C6B55E518478139F604F542D138AE3BC34BAD01EE6002006D64C4FF82"
      ),
    },
  },
];
