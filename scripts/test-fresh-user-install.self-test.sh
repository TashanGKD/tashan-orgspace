#!/bin/sh
set -eu

repository_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
runner="$repository_root/scripts/test-fresh-user-install.sh"

usage_output=$($runner 2>&1) || {
  printf '%s\n' "fresh-user self-test: no-argument runner must succeed" >&2
  exit 1
}
printf '%s\n' "$usage_output" | grep -Fq "Usage:" || {
  printf '%s\n' "fresh-user self-test: no-argument runner did not print usage" >&2
  exit 1
}

set +e
corrupt_output=$(TORG_FRESH_TESTING=1 TORG_FRESH_TEST_CORRUPT=1 "$runner" --local-build 2>&1)
corrupt_status=$?
set -e
[ "$corrupt_status" -ne 0 ] || {
  printf '%s\n' "fresh-user self-test: corrupt release was accepted" >&2
  exit 1
}
printf '%s\n' "$corrupt_output" | grep -Fq "checksum verification failed" || {
  printf '%s\n' "fresh-user self-test: checksum rejection was not observed" >&2
  exit 1
}
printf '%s\n' "$corrupt_output" | grep -Fq "rejected install left fresh HOME unchanged" || {
  printf '%s\n' "fresh-user self-test: rejected-install cleanup was not proven" >&2
  exit 1
}

printf '%s\n' "test-fresh-user-install.self-test: PASS"
