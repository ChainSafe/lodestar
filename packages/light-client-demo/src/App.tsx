import React, {useEffect, useState} from "react";

import ForkMe from "./components/ForkMe";
import Header from "./components/Header";
import Footer from "./components/Footer";

import {params} from "@chainsafe/lodestar-params/minimal";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {LightClientStatus} from "./components/LightClientStatus";
import {Lightclient} from "@chainsafe/lodestar-light-client/lib/client";
import {Clock} from "@chainsafe/lodestar-light-client/lib/utils/clock";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {ProofReqResp} from "./ProofReqResp";

const config = createIBeaconConfig({
  ...params,
  ALTAIR_FORK_EPOCH: 0,
});

const trustedRoot = {
  stateRoot: config.types.Root.defaultValue(),
  slot: 0,
};
const genesisTime = 0;
const genesisValidatorsRoot = config.types.Root.defaultValue();
const beaconApiUrl = "http://localhost:9596";

export default function App(): JSX.Element {
  const [client, setClient] = useState<Lightclient | undefined>();
  useEffect(() => {
    Lightclient.initializeFromTrustedStateRoot(
      config,
      new Clock(config, new WinstonLogger(), genesisTime),
      genesisValidatorsRoot,
      beaconApiUrl,
      trustedRoot,
    ).then(setClient);
  });
  return (
    <>
      <ForkMe />
      <Header />
      {
        !client ?
          <div className="container">
            <div>Initializing...</div>
          </div> :
          <div className="section">
            <LightClientStatus client={client} />
            <ProofReqResp client={client} />
          </div>
      }
      <Footer />
    </>
  );
}
