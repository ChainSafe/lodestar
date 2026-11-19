#!/bin/bash

# You can sort the wordlist by running:
# ```
# $ scripts/wordlist_sort.sh
# ```

# Define wordlist file
wordlist=".wordlist.txt"

# Ensure deterministic collation across environments
export LC_ALL=C

# Check if wordlist is sorted
if ! sort --ignore-case --human-numeric-sort --check "$wordlist"; then
  echo "Error: The wordlist is not sorted."
  exit 1
fi

# Check for repeated words
if uniq -d "$wordlist" | grep -q .; then
  echo "Error: The wordlist contains repeated words."
  exit 1
fi

echo "The wordlist is sorted and contains no repeated words."