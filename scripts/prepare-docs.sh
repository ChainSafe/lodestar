#!/bin/bash

DOCS_DIR=docs

# exit when any command fails
set -e

# Move autogenerated reference
mv packages/cli/docs/cli.md $DOCS_DIR/pages/reference/cli.md

# Copy contributing doc
cp CONTRIBUTING.md $DOCS_DIR/pages/contribution/getting-started.md

# Copy visual assets
rm -rf $DOCS_DIR/assets
cp -r assets $DOCS_DIR/assets
