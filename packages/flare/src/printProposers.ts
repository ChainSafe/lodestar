import {getClient} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {toHex} from "@lodestar/utils";
import {routes} from "@lodestar/api/beacon";
import {computeEpochAtSlot} from "@lodestar/state-transition";

/* eslint-disable no-console */

const client = getClient({baseUrl: "http://localhost:4000"}, {config});
let lastDependantRoot = "";

const controller = new AbortController();
client.events.eventstream([routes.events.EventType.block], controller.signal, (event) => {
  if (event.type === routes.events.EventType.block) {
    const epoch = computeEpochAtSlot(event.message.slot);
    client.validator
      .getProposerDuties(epoch)
      .then((res) => {
        const dependentRoot = toHex(res.dependentRoot);
        if (dependentRoot != lastDependantRoot) {
          console.log(epoch, res.data.map((d) => d.validatorIndex).join(" "));
          lastDependantRoot = dependentRoot;
        }
      })
      .catch(console.error);
  }
});
