import React, {useEffect, useState, useCallback} from "react";
import {Lightclient} from "@chainsafe/lodestar-light-client/lib/client";
import {BlockHeader} from "./components/BlockHeader";
import {ErrorView} from "./components/ErrorView";
import {ReqStatus} from "./types";
import {config} from "./config";
import {altair} from "@chainsafe/lodestar-types";

export function LightClientStatus({client}: {client: Lightclient}): JSX.Element {
  const [reqStatusSync, setReqStatusSync] = useState<ReqStatus<altair.BeaconBlockHeader>>({});

  const sync = useCallback(async () => {
    try {
      setReqStatusSync({loading: true});
      await client.sync();
      console.log({snapshot: client.store.snapshot});
      setReqStatusSync({result: client.store.snapshot.header});
    } catch (e) {
      setReqStatusSync({error: e});
    }
  }, [client, setReqStatusSync]);

  // Sync once at start
  useEffect(() => {
    sync();
  }, [sync]);

  // Sync every epoch
  useEffect(() => {
    const interval = setInterval(sync, config.params.SECONDS_PER_SLOT * 1000);
    return () => clearInterval(interval);
  });

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
          <div className="subtitle">Latest Synced Snapshot Header</div>
          <BlockHeader config={client.config} header={client.store.snapshot.header} />
        </div>
      </div>
    </div>
  );
}
