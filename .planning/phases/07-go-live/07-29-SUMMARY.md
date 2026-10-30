---
phase: 07-go-live
plan: 29
gate: G-7
status: complete
---

# 07-29 Summary: G-7 EVACUATE on

Owner reply (2026-10-30): "g-7 approved".

## Done
- ADMIN_EVACUATE=on on the production worker; worker fc26025e deployed from `6098e98` with deploy.sh.
- Boot log: genesis line, switches off, contract check passed, no refusal of ADMIN_EVACUATE. Nothing was evacuated.
- In genesis EVACUATE answers not_ready; it works once BONDR_QUOTE_MINT is set at G-5.
