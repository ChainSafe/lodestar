#!/bin/bash

# Define wordlist file
wordlist=".wordlist.txt"

# Sort the wordlist in place
sort -o "$wordlist" "$wordlist"
