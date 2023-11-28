#!/bin/bash

DOCS_DIR=docs

# exit when any command fails
set -e

# Copy contributing doc
cp CONTRIBUTING.md $DOCS_DIR/pages/contribution/getting-started.md

# Copy visual assets
rm -rf $DOCS_DIR/pages/assets
cp -r $DOCS_DIR/assets $DOCS_DIR/pages/assets
