#!/bin/sh
# The suites in WebKit — as close to Safari as this machine gets.
#
# Playwright's WebKit build links Ubuntu's ICU 74 and libjpeg 8, and Fedora
# ships ICU 77 and libjpeg-turbo, so it cannot start here: `playwright install
# webkit` downloads a browser that will not run. Playwright's own image has the
# libraries it wants, and is pinned to the version in package.json.
#
# It runs as the calling user so nothing lands in the tree owned by root, and
# it has no audio device at all — which is the reason the visualiser suite,
# alone in needing sound, is not part of an engine-agnostic run.
#
#   test/webkit.sh              every suite that runs everywhere
#   test/webkit.sh menu --verbose   the same filters run.js takes
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
exec docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$ROOT:/work" -w /work/test \
  mcr.microsoft.com/playwright:v1.62.1-noble node run.js --engine=webkit "$@"
