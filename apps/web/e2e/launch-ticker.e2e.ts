// Step 4 renders the ticker refusals with the wait from the refusal body (D-43, D-44, UI-SPEC A1, A2). Prepare is
// stubbed, so the worker's own cooldown plays no part; the copy itself is pinned in lib/ticker-copy.test.ts.
import { expect, test } from "@playwright/test";
import { signRow, stub, toSign } from "./launch-stubs.ts";
import { newTestAccount } from "./phantom.ts";

const cases = [
  {
    json: { error: "ticker_locked", retryAfter: 75600, lock: "landed" },
    copy: "$GRUB launched on BONDR 3h ago. Try again in 21h, or change the ticker in step 1. Nothing was sent.",
  },
  {
    json: { error: "ticker_reserved" },
    copy: "$GRUB is reserved on BONDR. Change the ticker in step 1. Nothing was sent.",
  },
];

for (const c of cases) {
  test(`${c.json.error} fails row 2 with its copy and no retry`, async ({ page }) => {
    await stub(page, { prepare: { status: 409, json: c.json } });
    await toSign(page, newTestAccount());
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(c.copy);
    await expect(signRow(page, 2)).toHaveAttribute("data-state", "failed");
    await expect(page.getByRole("button", { name: /Try again|Build again/ })).toHaveCount(0);
  });
}
