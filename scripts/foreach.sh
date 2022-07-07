#!/bin/bash

WORKSPACE_DIR=./packages

for d in $WORKSPACE_DIR/* ; do
    (cd "$d" && eval "$@")
done
