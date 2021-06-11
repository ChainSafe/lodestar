import {runEffectiveBalanceUpdates} from "./effective_balance_updates";
import {PresetName} from "@chainsafe/lodestar-params";

runEffectiveBalanceUpdates(PresetName.minimal);
