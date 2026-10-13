// Failures with a known cause, on either side. A failure of a pair that matches one of these is reported as a known
// issue in the summary row and does not fail the job, anything else on that pair still does. An entry needs the
// client, a pattern for the failure text and a note, optionally a log file and a pattern that has to confirm the cause
// and the link to the issue. Remove an entry once the fix is in the image the nightly runs, the failure stops matching
// on its own.
export const knownIssues = [
  {
    client: "prysm",
    failure: /^lodestar bn \(node 3\): \d+ REST API error responses \(getAggregatedAttestationV2 404 x\d+\)$/,
    note: "Lodestar hands out attestation data with the next epoch's source after 2/3 of the last slot of an epoch, the prysm aggregators re-fetch the data at that point",
    issue: "https://github.com/ChainSafe/lodestar/issues/10368",
  },
  {
    client: "prysm",
    failure: /^lodestar vc \(node 2\) log: warn: Proposer duties re-org/,
    note: "the prysm beacon node returns the dependent root of the current epoch for next-epoch proposer duties",
    issue: "https://github.com/OffchainLabs/prysm/issues/17681",
  },
  {
    client: "nimbus",
    failure: /nimbus vc exited/,
    evidence: ["vc3-nimbus.log", /Doppelganger detection triggered/],
    note: "the nimbus validator client trips its own doppelganger detection on a block proposal in epoch 0, or on Lodestar reporting last-slot attesters live in the next epoch (ChainSafe/lodestar#10367)",
    issue: "https://github.com/status-im/nimbus-eth2/issues/9278",
  },
  {
    client: "vero",
    failure: /Required field 'SECONDS_PER_SLOT' missing from spec/,
    note: "vero still requires SECONDS_PER_SLOT, the spec only has SLOT_DURATION_MS",
    issue: "https://github.com/serenita-org/vero/issues/353",
  },
];
