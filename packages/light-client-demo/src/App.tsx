import React, {useEffect, useState} from "react";

import ForkMe from "./components/ForkMe";
import Header from "./components/Header";
import Footer from "./components/Footer";

import {LightClientStatus} from "./LightClientStatus";
import {Lightclient} from "@chainsafe/lodestar-light-client/lib/client";
import {Clock} from "@chainsafe/lodestar-light-client/lib/utils/clock";
import {init} from "@chainsafe/bls";
import {ProofReqResp} from "./ProofReqResp";
import {ErrorView} from "./components/ErrorView";
import {ReqStatus} from "./types";
import {config, genesisTime, genesisValidatorsRoot, beaconApiUrl, trustedRoot} from "./config";

export default function App(): JSX.Element {
  const [reqStatusInit, setReqStatusInit] = useState<ReqStatus<Lightclient>>({});

  const [client, setClient] = useState<Lightclient | undefined>();

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
        setClient(client);
        setReqStatusInit({result: client});
      } catch (e) {
        setReqStatusInit({error: e});
      }
    }
    initializeFromTrustedStateRoot();
  }, []);

  return (
    <>
      <ForkMe />
      <Header />

      {reqStatusInit.result ? (
        <div className="section">
          <LightClientStatus client={reqStatusInit.result} />
          <ProofReqResp client={reqStatusInit.result} />
        </div>
      ) : reqStatusInit.error ? (
        <ErrorView error={reqStatusInit.error}></ErrorView>
      ) : reqStatusInit.loading ? (
        <p>Initializing Lightclient...</p>
      ) : null}

      <Footer />
    </>
  );
}
