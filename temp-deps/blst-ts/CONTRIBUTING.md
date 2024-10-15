# Contributing

## Welcome

Thank you for your interest in contribution to the `blst-ts` project.  This file will serve as your guide using the repo and some of the nuances of the architecture used within.  Note that this repo contains a git submodule. Make sure the git submodule `blst` is populated before attempting to build locally.

```sh
git submodule update --init --recursive
yarn
```

### Scripts

#### `download-spec-tests`

Pulls the spec test from the `ethereum/consensus-spec` repo and puts them in the `spec-tests` folder.

#### `test:unit`

Runs the unit tests in `test/unit` via mocha

#### `test:spec`

Runs the unit tests in `test/spec` via mocha.  It is important do download the spec tests before running this.

#### `test:memory`

Runs a test rig for creating thousands of object instances to get a mean-reversion value for the memory consumed by a single instance.

#### `test:perf`

Uses `@dapplion/benchmark` to run the test in `test/perf`.  Results from these tests are posted to PR bodies and checked against the values on `master` to make sure there are no regressions and to highlight significant performance increases.
