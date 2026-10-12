// Failures with a known cause on the other client's side. A failure of a pair that matches one of these is reported as
// a known issue in the summary row and does not fail the job, anything else on that pair still does. An entry needs the
// client, a pattern for the failure text and a note, optionally a log file and a pattern that has to confirm the cause
// and the link to the upstream issue. Remove an entry once the fix is in the client's default-branch image, the failure
// stops matching on its own.
export const knownIssues = [
  {
    client: "teku",
    failure: /^finalized epoch [01] after \d+s, wanted/,
    evidence: ["bn2-teku.log", /Failed to publish .* No peers for message topics/],
    note: "teku drops the subscription announcement of a peer with more than 200 topics in one message, a Lodestar supernode subscribed to all subnets announces 205, so teku never publishes to it",
  },
  {
    client: "prysm",
    failure: /^lodestar bn \(node 3\): \d+ REST API error responses \(getAggregatedAttestationV2 404 x\d+\)$/,
    note: "the prysm validator client attests after its aggregation step, so the aggregates it asks for are not in the pool yet",
  },
  {
    client: "prysm",
    failure: /^lodestar vc \(node 2\) log: warn: Proposer duties re-org/,
    note: "the prysm beacon node returns the dependent root of the current epoch for next-epoch proposer duties",
  },
  {
    client: "nimbus",
    failure: /nimbus vc exited/,
    evidence: ["vc3-nimbus.log", /Doppelganger detection triggered/],
    note: "the nimbus validator client trips its own doppelganger detection on the duties it performed through Lodestar in epoch 0 and exits",
  },
  {
    client: "vero",
    failure: /Required field 'SECONDS_PER_SLOT' missing from spec/,
    note: "vero still requires SECONDS_PER_SLOT, the spec only has SLOT_DURATION_MS",
  },
];
