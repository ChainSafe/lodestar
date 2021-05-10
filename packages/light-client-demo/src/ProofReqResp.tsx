import React, {useState} from "react";
import {Lightclient} from "@chainsafe/lodestar-light-client/lib/client";
import {TreeOffsetProof} from "@chainsafe/persistent-merkle-tree";
import {altair} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {ReqStatus} from "./types";
import {ErrorView} from "./components/ErrorView";

type Path = (string | number)[];

function renderState(paths: Path[], state: altair.BeaconState | null): string {
  if (!state) return "";
  return paths.map((path) => path.join(".") + " " + path.reduce((acc, p) => acc[p], state)).join("\n");
}

function renderProof(proof: TreeOffsetProof): string {
  const hexJson = {
    type: proof.type,
    leaves: proof.leaves.map(toHexString),
    offsets: proof.offsets,
  };
  return JSON.stringify(hexJson, null, 2);
}

export function ProofReqResp({client}: {client: Lightclient}): JSX.Element {
  const [reqStatusProof, setReqStatusProof] = useState<ReqStatus<{proof: TreeOffsetProof; stateStr: string}>>({});
  const [pathsStr, setPaths] = useState(JSON.stringify([["slot"], ["validators", 0, "exitEpoch"]], null, 2));

  async function fetchProof(): Promise<void> {
    try {
      setReqStatusProof({loading: true});
      const pathsQueried = JSON.parse(pathsStr);
      const proof = await client.getStateProof(pathsQueried);
      if (proof.leaves.length <= 0) {
        throw Error("Empty proof");
      }
      const state = client.config.types.altair.BeaconState.createTreeBackedFromProofUnsafe(proof);
      const stateStr = renderState(pathsQueried, state ?? null);
      setReqStatusProof({result: {proof, stateStr}});
    } catch (e) {
      setReqStatusProof({error: e});
    }
  }

  return (
    <section>
      <h2>Proof Req/Resp</h2>
      <div className="proof-container">
        <div className="paths">
          <h3>Paths</h3>
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

          {reqStatusProof.loading && <p>Fetching proof...</p>}
          {reqStatusProof.error && <ErrorView error={reqStatusProof.error} />}

          <div className="field">
            <div className="control">
              <button className="strong-gradient" onClick={fetchProof} disabled={reqStatusProof.loading}>
                Submit
              </button>
            </div>
          </div>
        </div>

        <div className="stateproof" style={{whiteSpace: "pre"}}>
          <h3>State</h3>
          {reqStatusProof.result ? <div>{reqStatusProof.result.stateStr}</div> : <p>no state</p>}

          <h3>Proof</h3>
          {reqStatusProof.result ? <div>{renderProof(reqStatusProof.result.proof)}</div> : <p>no proof</p>}
          <br />
        </div>
      </div>
    </section>
  );
}
