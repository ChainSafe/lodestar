#!/bin/bash

DOCS_DIR=docs

# exit when any command fails
set -e

# Copy contributing docs
cp CONTRIBUTING.md $DOCS_DIR/pages/contribution/getting-started.md

# Copy package README.md to docs
cp -r packages/light-client/README.md $DOCS_DIR/pages/lightclient-prover/lightclient.md
cp -r packages/prover/README.md $DOCS_DIR/pages/lightclient-prover/prover.md

# Copy visual assets
rm -rf $DOCS_DIR/pages/assets
cp -r $DOCS_DIR/assets $DOCS_DIR/pages/assets
