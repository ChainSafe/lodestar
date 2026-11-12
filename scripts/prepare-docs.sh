#!/bin/bash

DOCS_DIR=docs
ASSETS_DIR=assets

# exit when any command fails
set -e

# Copy contributing docs
cp CONTRIBUTING.md $DOCS_DIR/pages/contribution/getting-started.md
cp SECURITY.md $DOCS_DIR/pages/security.md

# Copy visual assets
rm -rf $DOCS_DIR/pages/assets $DOCS_DIR/pages/images
cp -r $ASSETS_DIR $DOCS_DIR/pages/assets

# Copy binary install script to docs
cp scripts/install-binary.sh $DOCS_DIR/static/install
