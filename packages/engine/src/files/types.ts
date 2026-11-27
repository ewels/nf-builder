// Types for the Files view (F-210). Plain, clone-safe data; nothing here depends on a language pack version.

/** Why a file can't be edited: `managed` files under `.nf-builder/` are written by nf-builder itself (F-207). */
export type ReadOnlyReason = "managed";
