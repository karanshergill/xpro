# ADR-006: CSV and Excel files with hucre

**Status:** Accepted | **Date:** 2026-09-26

## Problem

- Clients import and export lists as CSV and Excel files.
- Imports must be checked row by row, with clear errors.
- Exported files must not be able to run formulas when opened.

## Decision

- CSV and Excel (.xlsx) are both handled by hucre: one library, no
  dependencies, built for edge runtimes like Cloudflare.
- Formula escaping is always turned on for exports.
- The exact version is pinned. Writing, reading and formula escaping were
  tested inside the Cloudflare runtime.

## Rejected options

- **Papa Parse with read-excel-file and write-excel-file:** mature and
  maintained, but three libraries to learn where one does both.
- **SheetJS:** its npm version dates from 2022 and has two high-severity
  security issues. The fixed version is only on its own download site, where
  automatic dependency updates cannot follow it, and it has had no release
  since July 2024.
- **ExcelJS:** no release since 2023, with hundreds of open issues.

## Impact

- **Better:** one library for both formats, with styling, schema checks and
  LibreOffice files available when needed.
- **Costs:** hucre is six months old, with one author doing almost all the
  work. If it stalls, the earlier trio is the fallback, which is why all file
  import and export goes through one internal module of ours.
