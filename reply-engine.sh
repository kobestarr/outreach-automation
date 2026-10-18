#!/bin/bash
# LaunchAgent entry point for reply-engine.js (node path varies: /usr/local/bin now, was /opt/homebrew/bin)
cd "$(dirname "$0")" && export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"; exec node reply-engine.js --once "$@"
