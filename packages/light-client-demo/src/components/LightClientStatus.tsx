import React from "react";

import {BlockHeader} from "./display/BlockHeader";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair} from "@chainsafe/lodestar-types";
import {Lightclient} from "@chainsafe/lodestar-light-client/lib/client";

export function LightClientStatus({client}: {client: Lightclient}): JSX.Element {
  return (
    <div className="light-client-status container">
      <div className="title is-3">
        Sync Status
      </div>
      <div className="columns">
        <div className="column section">
          <div className="subtitle">
            Clock Slot
          </div>
          <div>
            {client.clock.currentSlot}
          </div>
        </div>
        <div className="column section">
          <div className="subtitle">
            Latest Synced Snapshot Header
          </div>
          <BlockHeader config={client.config} header={client.store.snapshot.header} />
        </div>
      </div>
    </div>
  );
}