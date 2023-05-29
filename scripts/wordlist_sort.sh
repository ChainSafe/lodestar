#!/bin/bash

# Define wordlist file
wordlist=".wordlist.txt"

# Sort the wordlist in place
sort --human-numeric-sort -o "$wordlist" "$wordlist"
