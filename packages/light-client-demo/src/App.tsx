import React, {useEffect, useState} from "react";
import {Lightclient} from "@chainsafe/lodestar-light-client/lib/client";
import {Clock} from "@chainsafe/lodestar-light-client/lib/utils/clock";
import {init} from "@chainsafe/bls";

import ForkMe from "./components/ForkMe";
import Header from "./components/Header";
import Footer from "./components/Footer";

import {SyncStatus} from "./SyncStatus";
import {TimeMonitor} from "./TimeMonitor";
import {ProofReqResp} from "./ProofReqResp";
import {ErrorView} from "./components/ErrorView";
import {ReqStatus} from "./types";
import {config, genesisTime, genesisValidatorsRoot, beaconApiUrl, trustedRoot} from "./config";

export default function App(): JSX.Element {
  const [reqStatusInit, setReqStatusInit] = useState<ReqStatus<Lightclient>>({});

  useEffect(() => {
    async function initializeFromTrustedStateRoot(): Promise<void> {
      try {
        await init("herumi");

        setReqStatusInit({loading: true});
        const clock = new Clock(config, genesisTime);
        const client = await Lightclient.initializeFromTrustedStateRoot(
          config,
          clock,
          genesisValidatorsRoot,
          beaconApiUrl,
          trustedRoot
        );
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
          <p>Initializing Lightclient...</p>
        ) : null}
      </main>

      <Footer />
    </>
  );
}
