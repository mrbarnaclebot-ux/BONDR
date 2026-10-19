# apps/web/components

- `chrome.tsx`: Header (brand, DEVNET badge, wallet control) and Footer, server components on every page.
- `wallet.tsx`: WalletProvider and useWallet, Phantom through Wallet Standard, plus local consent state.
- `wallet-button.tsx`: the header wallet control, its Copy address / Disconnect menu and the not-installed popover.
- `consent-dialog.tsx`: the first-connect consent prompt (native dialog, bottom sheet on phones).
- `ui-button.tsx`: Button and buttonVariants, hand-ported shadcn 4.21.2 with the UI-SPEC variants.
- `ui-field.tsx`: Input, Textarea, Label (optional marker) and FieldError, hand-ported shadcn 4.21.2.
- `launch-flow.tsx`: the /launch state machine (steps 1-5) and the step panel with its focus target.
- `launch-stepper.tsx`: the five-node bond-chain stepper.
- `launch-coin.tsx`: step 1 Coin, every field checked with `@bondr/core/rules` and the UI-SPEC copy.
- `launch-drop.tsx`: the step 1 image drop zone.
- `launch-buy.tsx`: step 2 Dev buy and exit, the live-minimum check, presets and the debounced quote hook.
- `launch-review.tsx`: step 3 Review, the fee callout and the connect / paused / sign button.
- `launch-receipt.tsx`: the receipt aside, every fee and cost from the live worker status.
- `callout.tsx`: info, warn and error callouts (status or alert role).
