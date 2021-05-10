import React, {useEffect, useState} from "react";

import ForkMe from "./components/ForkMe";
import Header from "./components/Header";
import Footer from "./components/Footer";

import {params} from "@chainsafe/lodestar-params/minimal";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {LightClientStatus} from "./components/LightClientStatus";
import {Lightclient} from "@chainsafe/lodestar-light-client/lib/client";
import {leveParams, leveGenesisTime} from "@chainsafe/lodestar-light-client/lib/leve";
import {Clock} from "@chainsafe/lodestar-light-client/lib/utils/clock";
import {init} from "@chainsafe/bls";
import {fromHex, WinstonLogger} from "@chainsafe/lodestar-utils";
import {ProofReqResp} from "./ProofReqResp";
import {ErrorView} from "./components/ErrorView";
import {ReqStatus} from "./types";

const config = createIBeaconConfig(leveParams);

const trustedRoot = {
  stateRoot: fromHex("0x96b09c52691647a6fd5f61e63c57c2f80db117096d1dd7e7e0df861e8f12a7d6"),
  slot: 0,
};
const genesisTime = leveGenesisTime;
const genesisValidatorsRoot = fromHex("0xea569bcb4fbb2ed26d30e997d7337e7e12a43ac115793e9cbe25da401fcbb725");
const beaconApiUrl = "http://localhost:31000";

export default function App(): JSX.Element {
  const [reqStatusInit, setReqStatusInit] = useState<ReqStatus<Lightclient>>({});

  const [client, setClient] = useState<Lightclient | undefined>();

  useEffect(() => {
    async function initializeFromTrustedStateRoot() {
      try {
        await init("herumi");

        setReqStatusInit({loading: true});
        const client = await Lightclient.initializeFromTrustedStateRoot(
          config,
          new Clock(config, new WinstonLogger(), genesisTime),
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
