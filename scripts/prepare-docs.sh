#!/bin/bash

DOCS_DIR=docs

# exit when any command fails
set -e

# Move typedoc documentation to the packages dir
rm -rf $DOCS_DIR/packages
mkdir -p $DOCS_DIR/packages
for PACKAGE_DIR in packages/* ; do
    cp -r $PACKAGE_DIR/docs $DOCS_DIR/$PACKAGE_DIR
done

# Copy contributing doc
cp CONTRIBUTING.md $DOCS_DIR/contributing.md

# Copy visual assets
rm -rf $DOCS_DIR/assets
cp -r assets $DOCS_DIR/assets
