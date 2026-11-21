# 0006. One language pack per Nextflow version; 26.10 only at launch

- Status: Accepted
- Date: 2026-11-21

## Context

Nextflow ships two stable releases a year, and the syntax keeps moving. 2027 releases will add more. Supporting old versions would multiply the work and push people towards outdated patterns.

## Decision

- A **language pack** holds everything version-specific:
  - grammar and parser;
  - catalogue;
  - palette;
  - printer;
  - lint rules;
  - templates;
  - project defaults, such as the `nextflowVersion` floor and the pinned tool versions for generated CI files.
- The engine only sees the pack interface. No Nextflow version literals outside `packages/lang-*`.
- Each project records its `languageVersion`. At launch the only pack is `26.10`.
- A new Nextflow release means a new pack. A pack may ship upgrade steps from the previous one, which power an "Upgrade project" action that shows a diff before applying.
- Keep packs for the two most recent stable releases. Older projects open read-only with an upgrade prompt.

## Consequences

- Supporting the first 2027 release is a contained piece of work. If it needs engine changes, the interface was wrong.
- Some duplication between packs. Shared code moves to `lang-core` once a second pack exists.

## Alternatives

- Version flags inside one pack: unreadable past two versions.
- Support from 24.10: triples testing for users we want to move on anyway.
