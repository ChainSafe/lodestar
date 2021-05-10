import React, {useEffect, useState} from "react";

import {BlockHeader} from "./display/BlockHeader";
import {Lightclient} from "@chainsafe/lodestar-light-client/lib/client";
import {ReqStatus} from "../types";
import {ErrorView} from "./ErrorView";

export function LightClientStatus({client}: {client: Lightclient}): JSX.Element {
  const [reqStatusSync, setReqStatusSync] = useState<ReqStatus<true>>({});

  useEffect(() => {
    async function sync() {
      try {
        setReqStatusSync({loading: true});
        await client.sync();
        console.log({snapshot: client.store.snapshot});
        setReqStatusSync({result: true});
      } catch (e) {
        setReqStatusSync({error: e});
      }
    }
    sync();
  }, [client]);

  return (
    <div className="section container">
      <div className="title is-3">Sync Status</div>

      {reqStatusSync.result ? (
        <p>Successfully synced!</p>
      ) : reqStatusSync.error ? (
        <ErrorView error={reqStatusSync.error}></ErrorView>
      ) : reqStatusSync.loading ? (
        <p>Syncing Lightclient...</p>
      ) : null}

      <div className="columns">
        <div className="column section">
          <div className="subtitle">Clock Slot</div>
          <div>{client.clock.currentSlot}</div>
        </div>
        <div className="column section">
          <div className="subtitle">Latest Synced Snapshot Header</div>
          <BlockHeader config={client.config} header={client.store.snapshot.header} />
        </div>
      </div>
    </div>
  );
}
