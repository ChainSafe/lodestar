import React from "react";

import ForkMe from "./components/ForkMe";
import Header from "./components/Header";
import Footer from "./components/Footer";

import {config} from "@chainsafe/lodestar-config/mainnet";
import {LightClientStatus} from "./components/LightClientStatus";
import {Lightclient} from "@chainsafe/lodestar-light-client/lib/client";
import {Clock} from "@chainsafe/lodestar-light-client/lib/utils/clock";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import { ProofReqResp } from "./ProofReqResp";

const genesisTime = 0;
const genesisValidatorsRoot = config.types.Root.defaultValue();
const beaconApiUrl = "http://localhost:9596";

const client = new Lightclient(
  {
    snapshot: {
      header: config.types.phase0.BeaconBlockHeader.defaultValue(),
      currentSyncCommittee: {
        pubkeys: [],
        pubkeyAggregates: [],
      },
      nextSyncCommittee: {
        pubkeys: [],
        pubkeyAggregates: [],
      },
    },
    validUpdates: [],
  },
  config,
  new Clock(config, new WinstonLogger(), genesisTime),
  genesisValidatorsRoot,
  beaconApiUrl
);

export default function App(): JSX.Element {
  return (
    <>
      <ForkMe />
      <Header />
      <LightClientStatus client={client} />
      <ProofReqResp client={client} />
      <Footer />
    </>
  );
}
