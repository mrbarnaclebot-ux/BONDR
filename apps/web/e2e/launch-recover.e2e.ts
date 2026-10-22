// Step 4 recovery while a submit is still inside the worker: the row reads prepared until the worker signs it.
import { expect, test } from "@playwright/test";
import { current } from "./coin.ts";
import { FACTS, signRow, stub, toSign, view } from "./launch-stubs.ts";
import { newTestAccount } from "./phantom.ts";

test("a reload during submit restores a prepared row on step 4 and follows it to live (web WR-04)", async ({
  page,
}) => {
  let landed = false; // flipped once step 4 is seen, so the restore cannot race past it
  await stub(page, {
    submit: { json: { state: "sent" }, delayMs: 10_000 },
    view: () => ({ json: landed ? view("landed", { facts: FACTS }) : view("prepared") }),
  });
  await toSign(page, newTestAccount());
  await expect(signRow(page, 4)).toHaveAttribute("data-state", "now");
  await page.reload();
  await expect(current(page)).toHaveText(/04\s*Sign/);
  landed = true;
  await expect(page.getByRole("heading", { name: "GRUB is live." })).toBeVisible({ timeout: 15_000 });
});

test("a row still prepared long after the submit ends as expired, not as an endless spinner (web WR-04)", async ({
  page,
}) => {
  await page.clock.install();
  await stub(page, { submit: { json: { state: "prepared" } }, view: () => ({ json: view("prepared") }) });
  await toSign(page, newTestAccount());
  await expect(signRow(page, 5)).toHaveAttribute("data-state", "now");
  await page.clock.fastForward("03:00");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("This transaction expired");
});
