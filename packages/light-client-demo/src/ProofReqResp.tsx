import React, {useState} from "react";
import {Lightclient} from "@chainsafe/lodestar-light-client/lib/client";
import {TreeOffsetProof} from "@chainsafe/persistent-merkle-tree";
import {altair, ssz} from "@chainsafe/lodestar-types";
import {CompositeType, toHexString, TreeBacked} from "@chainsafe/ssz";
import {ReqStatus} from "./types";
import {ErrorView} from "./components/ErrorView";

const initialPathStr = `[
  ["slot"],
  ["balances", 0],
  ["balances", 1]
]`;

type Path = (string | number)[];
type StateRender = {key: string; value: string}[];
type Json = Record<string | number, string | number>;

function renderState(paths: Path[], state: TreeBacked<altair.BeaconState> | null): StateRender {
  if (!state) return [];
  return paths.map((path) => ({
    key: path.join("."),
    value: getStateData(state, path),
  }));
}

function getStateData(state: TreeBacked<altair.BeaconState>, path: Path): string {
  let value = state as object;
  let type = state.type as CompositeType<object>;
  for (const indexer of path) {
    type = type.getPropertyType(indexer) as CompositeType<object>;
    value = (value as Record<string, unknown>)[String(indexer)] as object;
  }
  try {
    return JSON.stringify(type.toJson(value.valueOf()), null, 2);
  } catch (e) {
    return "-";
  }
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
  const [reqStatusProof, setReqStatusProof] = useState<ReqStatus<{proof: TreeOffsetProof; stateStr: StateRender}>>({});
  const [pathsStr, setPaths] = useState(initialPathStr);

  async function fetchProof(): Promise<void> {
    try {
      setReqStatusProof({loading: true});
      const pathsQueried = JSON.parse(pathsStr);
      const proof = await client.getStateProof(pathsQueried);
      if (proof.leaves.length <= 0) {
        throw Error("Empty proof");
      }
      const state = ssz.altair.BeaconState.createTreeBackedFromProofUnsafe(proof);
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
              <textarea className="textarea" rows={6} value={pathsStr} onChange={(evt) => setPaths(evt.target.value)} />
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

        <div className="state-proof" style={{whiteSpace: "pre"}}>
          <h3>State</h3>
          {reqStatusProof.result ? (
            <div className="grid-2col-render">
              {reqStatusProof.result.stateStr.map((item, i) => (
                <React.Fragment key={i}>
                  <span>{item.key}</span>
                  <span>{item.value}</span>
                </React.Fragment>
              ))}
            </div>
          ) : (
            <p>no state</p>
          )}

          <h3>Proof</h3>
          {reqStatusProof.result ? (
            <div className="proof-render">{renderProof(reqStatusProof.result.proof)}</div>
          ) : (
            <p>no proof</p>
          )}
          <br />
        </div>
      </div>
    </section>
  );
}
