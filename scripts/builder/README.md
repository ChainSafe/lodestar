# Native upgrade qualification

After building the packages and the mainnet native addon, capture a Gloas fixture
from a trusted Plataberget beacon API and replay it locally:

```sh
python3 scripts/builder/captureNativeUpgrade.py /tmp/native-upgrade-fixture --beacon http://127.0.0.1:9596
node --expose-gc --max-old-space-size=4096 scripts/builder/qualifyNativeUpgrade.mjs /tmp/native-upgrade-fixture
```

Capture uses bounded GET requests. It creates a new directory containing the
finalized state, chain configuration, and the following epoch's available blocks.
Run the replay on a separate machine to keep test load off the live beacon node.

Replay compares native and TypeScript state roots, builder liabilities, full
parent preparation, empty parent preservation, slot processing and an epoch
transition. It then verifies real blocks with proposer and operation signature
checks and matches their recorded state roots. It sends no Engine API requests:
execution validity is inherited from the captured canonical blocks. This checks
consensus compatibility; it is not an execution validation or live latency test.

On 20 November, a captured state with 85,539 validators and 28 available blocks
across 32 slots passed these checks against upstream `269cf1aa5bcf`. The four
missing slots were recorded explicitly.

To check recovery across a publisher upgrade, build the old and new repositories,
then write a synthetic journal with the old publisher and recover it with the new
one. Use a new directory, never a live journal:

```sh
node scripts/builder/qualifyJournalUpgrade.mjs write /path/to/old-build /tmp/journal-upgrade/records
node scripts/builder/qualifyJournalUpgrade.mjs read /path/to/new-build /tmp/journal-upgrade/records
```

Create the parent directory first. The writer requires the old transaction array
representation. The reader checks identical execution payload bytes and signed
bid roots after recovery, and confirms that a recovered reveal obligation does
not become permission to offer the bid again. The transactions are synthetic SSZ
test data; this does not execute or broadcast them.
