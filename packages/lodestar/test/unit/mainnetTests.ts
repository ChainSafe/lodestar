import {PresetName, setActivePreset} from "@chainsafe/lodestar-params/setPreset";

// need to run this before loading lodestar-params module
setActivePreset(PresetName.mainnet);

import {runGossipScoringParametersTests} from "./network/gossip/scoringParameters";
runGossipScoringParametersTests();
