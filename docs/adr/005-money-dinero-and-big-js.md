# ADR-005: Money with Dinero.js, other exact decimals with big.js

**Status:** Accepted | **Date:** 2026-09-25

## Problem

- Amounts must be exact. JavaScript numbers are not: 0.1 + 0.2 gives
  0.30000000000000004.
- Money needs its currency kept with it, fair splitting (a total split
  three ways must still add up), currency conversion and clear rounding.
- Quantities, unit prices, rates and percentages need exact decimals too,
  but they are not money.

## Decision

- Money is handled with Dinero.js version 2: each amount is stored in the
  currency's smallest unit together with its currency.
- Other exact decimals are handled with big.js.
- Other exact decimals are stored as whole numbers at a fixed scale for
  each column (for example, a quantity kept in thousandths), never in
  SQLite's decimal type, which rounds. Every save checks the value fits
  within JavaScript's safe whole-number range.
- Amounts are shown to users with the platform's built-in formatting, in the
  user's language.

## Rejected options

- **Plain JavaScript numbers:** rounding errors in totals and taxes.
- **Our own money code:** splitting, conversion and rounding are easy to get
  subtly wrong, and proven libraries already cover them.
- **big.js for money too:** it knows nothing about currencies, so every money
  rule would be written by hand.

## Impact

- **Better:** exact totals, currencies that cannot be mixed by mistake, and
  splits that always add up.
- **Costs:** two libraries to learn, and a rule to follow: amounts never pass
  through plain numbers on the way. Each exact-decimal column needs its
  scale chosen when it is created.
