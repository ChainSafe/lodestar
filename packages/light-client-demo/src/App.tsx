import React, {useEffect, useState} from "react";
import {Lightclient} from "@chainsafe/lodestar-light-client/lib/client";
import {Clock} from "@chainsafe/lodestar-light-client/lib/utils/clock";
import {init} from "@chainsafe/bls";
import Header from "./components/Header";
import Footer from "./components/Footer";
import {ErrorView} from "./components/ErrorView";
import {SyncStatus} from "./SyncStatus";
import {TimeMonitor} from "./TimeMonitor";
import {ProofReqResp} from "./ProofReqResp";
import {ReqStatus} from "./types";
import {readSnapshot} from "./storage";
import {config, genesisTime, genesisValidatorsRoot, beaconApiUrl, trustedRoot} from "./config";

export default function App(): JSX.Element {
  const [reqStatusInit, setReqStatusInit] = useState<ReqStatus<Lightclient, string>>({});

  useEffect(() => {
    async function initializeFromTrustedStateRoot(): Promise<void> {
      try {
        await init("herumi");

        const clock = new Clock(config, genesisTime);

        // Check if there is state persisted
        const prevSnapshot = readSnapshot();
        setReqStatusInit({
          loading: prevSnapshot
            ? `Restoring prevSnapshot at slot ${prevSnapshot.header.slot}`
            : `Syncing from trusted root at slot ${trustedRoot.slot}`,
        });

        const modules = {config, clock, genesisValidatorsRoot, beaconApiUrl};
        const client = prevSnapshot
          ? Lightclient.initializeFromTrustedSnapshot(modules, prevSnapshot)
          : await Lightclient.initializeFromTrustedStateRoot(modules, trustedRoot);
        setReqStatusInit({result: client});
      } catch (e) {
        setReqStatusInit({error: e});
      }
    }
    initializeFromTrustedStateRoot();
  }, []);

  return (
    <>
      <Header />

      <main>
        <TimeMonitor />

        {reqStatusInit.result ? (
          <>
            <SyncStatus client={reqStatusInit.result} />
            <ProofReqResp client={reqStatusInit.result} />
          </>
        ) : reqStatusInit.error ? (
          <ErrorView error={reqStatusInit.error} />
        ) : reqStatusInit.loading ? (
          <p>Initializing Lightclient - {reqStatusInit.loading}</p>
        ) : null}
      </main>

      <Footer />
    </>
  );
}
