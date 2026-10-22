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

test("a resend refused by the rate limit leaves the launch to its row, which lands (web WR-05)", async ({
  page,
}) => {
  await stub(page, { view: (n) => ({ json: n < 3 ? view("prepared") : view("landed", { facts: FACTS }) }) });
  let submits = 0;
  await page.route("**/api/launch/submit", (r) =>
    r.fulfill(
      ++submits === 1
        ? { status: 503, json: { error: "worker_unavailable" } }
        : { status: 429, json: { error: "rate_limited" } },
    ),
  );
  await toSign(page, newTestAccount());
  await expect(page.getByRole("heading", { name: "GRUB is live." })).toBeVisible({ timeout: 15_000 });
  expect(submits).toBeGreaterThan(1);
});
