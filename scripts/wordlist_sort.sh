#!/bin/bash

# Define wordlist file
wordlist=".wordlist.txt"

# Ensure deterministic collation across environments
export LC_ALL=C

# Sort the wordlist in place (match check script options)
sort --ignore-case --human-numeric-sort -o "$wordlist" "$wordlist"
