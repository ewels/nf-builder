#!/usr/bin/env bash
# Re-copy the vendored Nextflow skills from seqeralabs/nextflow-plugin.
# Usage: .claude/skills/sync.sh [commit]   Default: the commit in UPSTREAM.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
ref="${1:-$(cat "$here/UPSTREAM")}"
skills=(
  build-nextflow-pipeline
  migrate-nextflow-code
  nextflow-config
  nextflow-output-patterns
  nextflow-schema
  nf-pipeline-design
  run-module
  search-existing-modules
)

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git clone --quiet --filter=blob:none --no-checkout https://github.com/seqeralabs/nextflow-plugin "$tmp/repo"
git -C "$tmp/repo" checkout --quiet "$ref"
src="$tmp/repo/plugins/nextflow"

for s in "${skills[@]}"; do
  rm -rf "${here:?}/$s"
  cp -R "$src/skills/$s" "$here/$s"
done
cp "$src/LICENSE" "$here/LICENSE-nextflow-plugin"
cp "$src/NOTICE" "$here/NOTICE-nextflow-plugin"
cp "$src/licenses/nextflow-agent-skills-Apache-2.0.txt" "$here/LICENSE-nextflow-agent-skills"
git -C "$tmp/repo" rev-parse HEAD > "$here/UPSTREAM"
echo "Synced ${#skills[@]} skills at $(cat "$here/UPSTREAM")"
