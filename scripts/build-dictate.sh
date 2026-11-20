#!/bin/sh
# Builds the dictation helper for the installed app (the dev app builds its own copy on first use).
set -e
cd "$(dirname "$0")/../resources/dictate"
swiftc -O main.swift -o cm2-dictate -target arm64-apple-macos26.0 \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Info.plist
codesign -s - -f -i dev.codemaxxer.dictate cm2-dictate
