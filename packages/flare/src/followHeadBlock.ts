import {getClient} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {toHex} from "@lodestar/utils";
import {routes} from "@lodestar/api/beacon";

/* eslint-disable no-console */

const client = getClient({baseUrl: "http://localhost:4000"}, {config});

const controller = new AbortController();
client.events.eventstream([routes.events.EventType.block], controller.signal, (event) => {
  if (event.type === routes.events.EventType.block) {
    client.beacon
      .getBlockV2(event.message.slot)
      .then((res) => {
        const block = res.data.message;

        console.log(
          "slot",
          block.slot,
          "proposerIndex",
          block.proposerIndex,
          Buffer.from(block.body.graffiti).toString("ascii"),
          toHex(block.body.eth1Data.blockHash)
        );
      })
      .catch(console.error);
  }
});
