import {init} from "@chainsafe/bls";
import {createIChainForkConfig} from "@chainsafe/lodestar-config";
import {toHexString} from "@chainsafe/ssz";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {altair, ssz} from "@chainsafe/lodestar-types";
import {getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {LightclientMockServer} from "../lightclientMockServer";
import {ServerOpts} from "../lightclientApiServer";
import {leveGenesisTime, leveParams} from "../../src/leve";
import {generateBalances, generateValidators, getInteropSyncCommittee} from "../utils";

/* eslint-disable @typescript-eslint/naming-convention, no-console */

async function runAltairChainSimulator(): Promise<void> {
  await init("blst-native");

  const config = createIChainForkConfig(leveParams);

  // Create blocks and state
  const validatorCount = 4;

  const serverOpts: ServerOpts = {port: 31000, host: "0.0.0.0"};

  // Create genesis state and block
  const genesisState = ssz.altair.BeaconState.defaultTreeBacked();
  const genesisBlock = ssz.altair.BeaconBlock.defaultValue();
  genesisState.validators = generateValidators(validatorCount);
  genesisState.balances = generateBalances(validatorCount);
  genesisState.currentSyncCommittee = getInteropSyncCommittee(0).syncCommittee;
  genesisState.nextSyncCommittee = getInteropSyncCommittee(1).syncCommittee;
  const genesisValidatorsRoot = ssz.altair.BeaconState.fields["validators"].hashTreeRoot(genesisState.validators);
  const genesisStateRoot = ssz.altair.BeaconState.hashTreeRoot(genesisState);
  genesisBlock.stateRoot = genesisStateRoot;
  const genesisCheckpoint: altair.Checkpoint = {
    root: ssz.altair.BeaconBlock.hashTreeRoot(genesisBlock),
    epoch: 0,
  };

  // TEMP log genesis for lightclient client
  console.log({
    genesisStateRoot: toHexString(genesisStateRoot),
    genesisValidatorsRoot: toHexString(genesisValidatorsRoot),
  });

  const logger = new WinstonLogger();
  const lightclientServer = new LightclientMockServer(config, logger, genesisValidatorsRoot);
  await lightclientServer.initialize({block: genesisBlock, state: genesisState, checkpoint: genesisCheckpoint});

  // Start API server
  await lightclientServer.startApiServer(serverOpts);

  // Compute all periods until currentSlot
  console.log("Syncing to latest slot...");
  for (let slot = 1; slot <= getCurrentSlot(config, leveGenesisTime); slot++) {
    await lightclientServer.createNewBlock(slot);
  }
  console.log("Synced to latest slot");

  // Advance the chain every slot
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Sleep until next slot
    const msPerSlot = config.SECONDS_PER_SLOT * 1000;
    const diffInMiliSeconds = Date.now() - leveGenesisTime * 1000;
    const msToNextSlot = msPerSlot - (diffInMiliSeconds % msPerSlot);
    await new Promise((r) => setTimeout(r, msToNextSlot));

    const slot = getCurrentSlot(config, leveGenesisTime);
    console.log("Slot", slot);
    await lightclientServer.createNewBlock(slot);
  }
}

runAltairChainSimulator().catch((e) => {
  console.error(e);
  process.exit(1);
});
