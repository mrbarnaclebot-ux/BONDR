# Phase 1: Chain Spike - Discussion Log

**Date:** 2026-10-19
**Phase:** 01-chain-spike
**Areas discussed:** Where the proof runs, BONDR stand-in states, Spike code, How fees get generated

---

## Where the proof runs

| Option | Description | Selected |
|--------|-------------|----------|
| Fork only | Surfpool mainnet fork, no real money until go-live | Yes |
| Fork + tiny mainnet smoke | One real insta-burn launch, about 0.3 SOL, public and permanent | |
| Fork + devnet | Pump devnet programs can lag mainnet | |

**User's choice:** Fork only

## BONDR stand-in states

| Option | Description | Selected |
|--------|-------------|----------|
| All three | On curve, mid-migration (expect 6107), migrated | Yes |
| On curve + migrated | Skip migration-window test | |
| On curve only | Leaves post-migration pricing unproven | |

**User's choice:** All three

## Spike code

| Option | Description | Selected |
|--------|-------------|----------|
| Foundation | Pump logic in packages/core, ported from agencybook; scripts are thin callers | Yes |
| Throwaway scripts | Faster now, Phase 2 rewrites | |

**User's choice:** Foundation

## How fees get generated

| Option | Description | Selected |
|--------|-------------|----------|
| Real trades + top-up | Real trades prove collect/split; labeled W top-up allowed to reach forced-bond threshold | Yes |
| Real trades only | About 250-330 SOL-equivalent of simulated volume per coin | |

**User's choice:** Real trades + top-up

## Claude's Discretion

Surfpool install and startup, script layout and run order, optional vanity mint in the spike, how size and compute units are measured.

## Deferred Ideas

Streamflow Token-2022 fork test (v2 LOCK-01), real-mainnet smoke (Phase 7), private send path proof (Phases 2 and 5).
