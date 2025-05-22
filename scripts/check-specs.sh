#!/bin/bash

# Activate virtual environment if it exists
if [ -d ".venv" ]; then
  source .venv/bin/activate
else
  echo "Virtual environment not found. Creating one..."
  python3 -m venv .venv
  source .venv/bin/activate
  pip install ethspecify
fi

# Run ethspecify with exclusion for node_modules
ethspecify --path ./packages --exclude "node_modules"

# Return to original state
deactivate 
