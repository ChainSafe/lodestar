#!/bin/bash

DOCS_DIR=docs
ASSETS_DIR=assets

# exit when any command fails
set -e

# Copy contributing docs
cp CONTRIBUTING.md $DOCS_DIR/pages/contribution/getting-started.md
cp SECURITY.md $DOCS_DIR/pages/security.md

# Copy package README.md to docs
cp -r packages/light-client/README.md $DOCS_DIR/pages/lightclient-prover/lightclient.md
cp -r packages/prover/README.md $DOCS_DIR/pages/lightclient-prover/prover.md

# Copy visual assets
rm -rf $DOCS_DIR/pages/assets $DOCS_DIR/pages/images
cp -r $ASSETS_DIR $DOCS_DIR/pages/assets
cp -r $DOCS_DIR/images $DOCS_DIR/pages/images
