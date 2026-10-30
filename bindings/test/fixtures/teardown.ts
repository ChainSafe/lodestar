import {config} from "@lodestar/config/default";
import * as era from "@lodestar/era";
import bindings from "../../src/index.js";
import {pubkeyCache} from "../../src/pubkeys.js";
import {getFirstEraFilePath} from "../eraFiles.js";
import {getSerializedFuluValidatorCount, getSerializedGenesisValidatorsRoot} from "../serializedState.js";

const reader = await era.era.EraReader.open(config, getFirstEraFilePath());
const stateBytes = await reader.readSerializedState();
await reader.close();

pubkeyCache.ensureCapacity(getSerializedFuluValidatorCount(stateBytes));

const nativeConfig = new bindings.BeaconConfig(config, getSerializedGenesisValidatorsRoot(stateBytes));
const seedState = bindings.BeaconStateView.createFromBytes(stateBytes, nativeConfig);
console.log(`slot=${seedState.slot}`);
