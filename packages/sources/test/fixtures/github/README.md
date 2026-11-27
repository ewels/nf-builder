# GitHub fixtures (F-401)

`nf-core-fetchngs-955c892.tree.json` is the trees API body for nf-core/fetchngs at 1.13.0 (commit 955c892d80927cee633765e6e390f9cc6b7235c9). It is produced from git, not from the API, because the sandbox can't call the API for nf-core: `git ls-tree -r -t -l` equals the API's recursive tree entry for entry (checked on 2,645 entries of another repository).

Regenerate it: `git init`, `git fetch --depth 1 https://github.com/nf-core/fetchngs.git <sha>`, then `node packages/sources/test/fixtures/github/make-tree.ts <git-dir> <sha> nf-core/fetchngs`.

To re-record from the live API: `curl -sS -H 'Accept: application/vnd.github+json' 'https://api.github.com/repos/nf-core/fetchngs/git/trees/<sha>?recursive=1'`.
