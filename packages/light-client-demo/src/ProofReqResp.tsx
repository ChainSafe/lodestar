import React, {useState} from "react";

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair} from "@chainsafe/lodestar-types";
import {Lightclient} from "@chainsafe/lodestar-light-client/lib/client";
import {ProofType, TreeOffsetProof} from "@chainsafe/persistent-merkle-tree";

type Path = (string | number)[];

export function ProofReqResp({client}: {client: Lightclient}): JSX.Element {
  const [pathsStr, setPaths] = useState(JSON.stringify([["slot"], ["validators", 0, "exitEpoch"]], null, 2));
  const [proof, setProof] = useState({type: ProofType.treeOffset, offsets: [], leaves: []} as TreeOffsetProof);
  const paths: Path[] = JSON.parse(pathsStr);
  const validProof = !!proof.leaves.length;
  const state = !validProof ? {} : client.config.types.altair.BeaconState.createTreeBackedFromProofUnsafe(proof);
  const stateStr = !validProof
    ? ""
    : paths
        .map((path) => {
          return path.join(".") + " " + path.reduce((acc, p) => acc[p], state);
        })
        .join("\n");

  return (
    <div className="section container">
      <div className="title is-3">Proof Req/Resp</div>
      <div className="columns">
        <div className="column section">
          <div className="subtitle">Paths</div>
          <div className="field">
            <div className="control">
              <textarea
                className="textarea"
                rows={10}
                value={pathsStr}
                onChange={(evt) => setPaths(evt.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <div className="control">
              <button className="button is-primary" onClick={() => client.getStateProof(paths).then(setProof)}>
                Submit
              </button>
            </div>
          </div>
        </div>
        <div className="column section">
          <div className="subtitle">Proof</div>
          <div>{JSON.stringify(proof, null, 2)}</div>
          <br />
          <div className="subtitle">State</div>
          <div>{stateStr}</div>
        </div>
      </div>
    </div>
  );
}
