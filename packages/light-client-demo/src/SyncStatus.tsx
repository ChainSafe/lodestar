import React, {useEffect, useState, useCallback} from "react";
import {debounce} from "debounce";
import {Lightclient, LightclientEvent} from "@chainsafe/lodestar-light-client/lib/client";
import {computeSyncPeriodAtSlot} from "@chainsafe/lodestar-light-client/lib/utils/syncPeriod";
import {altair} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {ErrorView} from "./components/ErrorView";
import {ReqStatus} from "./types";
import {config} from "./config";
import {writeSnapshot} from "./storage";

export function SyncStatus({client}: {client: Lightclient}): JSX.Element {
  const [_header, setHeader] = useState<altair.BeaconBlockHeader>();
  const [reqStatusSync, setReqStatusSync] = useState<ReqStatus>({});

  const sync = useCallback(async () => {
    try {
      setReqStatusSync({loading: true});
      await client.sync();
      setReqStatusSync({result: true});
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
    const interval = setInterval(sync, config.SECONDS_PER_SLOT * 1000);
    return () => clearInterval(interval);
  });

  // Subscribe to update head events
  useEffect(() => {
    const onNewHeader = (newHeader: altair.BeaconBlockHeader): void => setHeader(newHeader);
    client.emitter.on(LightclientEvent.newHeader, onNewHeader);
    return () => client.emitter.off(LightclientEvent.newHeader, onNewHeader);
  }, [client, setHeader]);

  // Subscribe to update sync committee events
  useEffect(() => {
    // debounce storing the snapshot since it does some expensive serialization
    const onAdvancedCommittee = debounce((): void => writeSnapshot(client.getSnapshot()), 250);
    client.emitter.on(LightclientEvent.advancedCommittee, onAdvancedCommittee);
    return () => client.emitter.off(LightclientEvent.advancedCommittee, onAdvancedCommittee);
  }, [client]);

  return (
    <section>
      <h2>Sync Status</h2>
      <div className="grid-2col-render">
        <span>syncPeriod</span>
        <span>{computeSyncPeriodAtSlot(client.config, client.store.snapshot.header.slot)}</span>
      </div>

      {reqStatusSync.result ? (
        <p>Successfully synced!</p>
      ) : reqStatusSync.error ? (
        <ErrorView error={reqStatusSync.error} />
      ) : reqStatusSync.loading ? (
        <p>Syncing Lightclient...</p>
      ) : null}

      <h3>Latest Synced Snapshot Header</h3>
      <div className="grid-2col-render">
        <span>slot</span>
        <span>{client.store.snapshot.header.slot}</span>
        <span>stateRoot</span>
        <span>{toHexString(client.store.snapshot.header.stateRoot)}</span>
      </div>
    </section>
  );
}
