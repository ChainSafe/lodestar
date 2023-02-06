import {toHexString} from "@chainsafe/ssz";
import {getStateTypeFromBytes} from "@lodestar/beacon-node";
import {createICachedGenesis, createIChainForkConfig} from "@lodestar/config";
import {networksChainConfig} from "@lodestar/config/networks";
import {ForkName} from "@lodestar/params";
import {getGenesisFileUrl, networkNames} from "../../src/networks/index.js";
import {downloadOrLoadFile} from "../../src/util/index.js";

const result: Record<string, Record<string, string>> = {};

for (const network of networkNames) {
  if (network === "dev" || network === "gnosis") continue;

  const genesisStateFile = getGenesisFileUrl(network);
  if (!genesisStateFile) throw Error("No genesis file url for network " + network);
  const stateBytes = await downloadOrLoadFile(genesisStateFile);
  const chainConfig = networksChainConfig[network];
  const chainForkConfig = createIChainForkConfig(chainConfig);
  const anchorState = getStateTypeFromBytes(chainForkConfig, stateBytes).deserializeToViewDU(stateBytes);
  if (network === "mainnet") {
    console.log("@@@ genesisvalidatorroot on mainnet", toHexString(anchorState.genesisValidatorsRoot));
  }
  const genesis = createICachedGenesis(chainForkConfig, anchorState.genesisValidatorsRoot);

  const perNetwork: Record<string, string> = {};
  for (const fork of [ForkName.phase0, ForkName.altair, ForkName.bellatrix]) {
    const forkDigest = toHexString(genesis.forkName2ForkDigest(fork));
    perNetwork[fork] = forkDigest;
  }
  result[network] = perNetwork;
}

console.table(result);