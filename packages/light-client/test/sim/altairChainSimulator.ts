import {init} from "@chainsafe/bls";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {toHexString} from "@chainsafe/ssz";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {altair} from "@chainsafe/lodestar-types";
import {getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {LightclientMockServer} from "../lightclientMockServer";
import {ServerOpts} from "../lightclientApiServer";
import {leveGenesisTime, leveParams} from "../../src/leve";
import {generateBalances, generateValidators, getInteropSyncCommittee} from "../utils";

/* eslint-disable @typescript-eslint/naming-convention */

async function runAltairChainSimulator(): Promise<void> {
  await init("blst-native");

  const config = createIBeaconConfig(leveParams);

  // Create blocks and state
  const validatorCount = 4;

  const serverOpts: ServerOpts = {port: 31000, host: "0.0.0.0"};

  // Create genesis state and block
  const genesisState = config.types.altair.BeaconState.defaultTreeBacked();
  const genesisBlock = config.types.altair.BeaconBlock.defaultValue();
  genesisState.validators = generateValidators(validatorCount);
  genesisState.balances = generateBalances(validatorCount);
  genesisState.currentSyncCommittee = getInteropSyncCommittee(config, 0).syncCommittee;
  genesisState.nextSyncCommittee = getInteropSyncCommittee(config, 1).syncCommittee;
  const genesisValidatorsRoot = config.types.altair.BeaconState.fields["validators"].hashTreeRoot(
    genesisState.validators
  );
  const genesisStateRoot = config.types.altair.BeaconState.hashTreeRoot(genesisState);
  genesisBlock.stateRoot = genesisStateRoot;
  const genesisCheckpoint: altair.Checkpoint = {
    root: config.types.altair.BeaconBlock.hashTreeRoot(genesisBlock),
    epoch: 0,
  };

  // TEMP log genesis for lightclient client
  console.log({
    genesisStateRoot: toHexString(genesisStateRoot),
    genesisValidatorsRoot: toHexString(genesisValidatorsRoot),
  });

  const logger = new WinstonLogger();
  const lightclientServer = new LightclientMockServer(config, logger, genesisValidatorsRoot, {
    block: genesisBlock,
    state: genesisState,
    checkpoint: genesisCheckpoint,
  });

  // Start API server
  await lightclientServer.startApiServer(serverOpts);

  // Compute all periods until currentSlot
  console.log("Syncing to latest slot...");
  for (let slot = 1; slot <= getCurrentSlot(config, leveGenesisTime); slot++) {
    lightclientServer.createNewBlock(slot);
  }
  console.log("Synced to latest slot");

  // Advance the chain every slot
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Sleep until next slot
    const msPerSlot = config.params.SECONDS_PER_SLOT * 1000;
    const diffInMiliSeconds = Date.now() - leveGenesisTime * 1000;
    const msToNextSlot = msPerSlot - (diffInMiliSeconds % msPerSlot);
    await new Promise((r) => setTimeout(r, msToNextSlot));

    const slot = getCurrentSlot(config, leveGenesisTime);
    console.log("Slot", slot);
    lightclientServer.createNewBlock(slot);
  }
}

runAltairChainSimulator().catch((e) => {
  console.error(e);
  process.exit(1);
});
