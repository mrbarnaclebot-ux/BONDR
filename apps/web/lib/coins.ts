// The token page's coin row; the query lives in core so the worker publishes the same numbers live.
import "server-only";
import { coinRow } from "@bondr/core/coin-row";
import { db } from "./db";

export const coinByMint = (mint: string) => coinRow(db(), mint);
