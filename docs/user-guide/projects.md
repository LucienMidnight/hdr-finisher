# Projects and Compatibility

New projects use edit-document schema v4 and default to a 203-nit HDR Reference White. A project stores its selected reference white, source-luminance description, independent false-color band-anchor and ceiling settings, neutral Detail controls, and inactive SDR Match state.

Schemas v1 through v3 are rejected. Project migration is not supported; create a new v4 project from the original source.

This pre-release change intentionally rejects prototype schema v1 and v2 projects. There is no migration, legacy fallback, or compatibility mode: create a new project and re-import the source. The error identifies the unsupported schema instead of silently reinterpreting old pixels.

Both 203- and 100-nit presets save and reopen without changing meaning. Changing only the project reference white invalidates rendered/proof results while retaining the decoded source proxy; changing source interpretation requires a source re-decode.

See [HDR Reference White](hdr-reference-white.md), [Import and metadata](import.md), and [Export and delivery](export.md).
