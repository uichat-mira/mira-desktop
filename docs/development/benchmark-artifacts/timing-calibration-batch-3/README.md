# Timing Calibration Batch 3 (#220)

Frozen evidence from #221 Runner and #223 Recorder. This is timing calibration only: it reports no formal Benchmark score, does not change the case contract, and leaves all `T_soft` / `T_hard` values unset.

## Identity and procedure

- Repository: `uichat-mira/mira-desktop`
- Mira source commit: `d0a8a98aec2d8cac3dfd04029f99cd4e9707c24d`
- Case set: `core-v0.1-rc1`; selection is frozen in `selection.json`.
- Runtime: local backend against a consistent SQLite copy on `127.0.0.1:8799`; the normal development backend/database was not used for case execution.
- Host: macOS `darwin/x64`, Node `v22.22.3`; execution classification is `adapted` for every observation.
- Provider/model: `default` / `deepseek-v4.1-flash` where observed; I04 primary rep-2 records model id as unknown.
- Every recorded run has calibration mode enabled, null `T_soft` / `T_hard`, no hard/soft cutoff, and no Runner safety-cap hit.

Recorder output is split into `primary/` (the exact selection-default 15 attempts) and `i04-followup/` (two additional I04 attempts). They remain separate because each Runner invocation numbers repetitions from 1; raw repetition identities were not rewritten or merged. The package manifests, per-run records, raw snapshots, trajectories, results, and judge inputs are retained in both directories.

## Timing observations

Only terminal `completed` runs with `adapted` classification, no safety cap, and no observability gaps count toward completion-time statistics. The retained I04 primary rep-2 ended at `waiting_user`, before the frozen validator-success boundary, and is excluded from the completion-time set without being deleted or described as an infrastructure failure.

| Case | Valid reps | Min (ms) | Median (ms) | Max (ms) | Max/min |
| --- | ---: | ---: | ---: | ---: | ---: |
| `beginner-05-local-version-no-network` | 3 | 7,239 | 8,238 | 9,228 | 1.27 |
| `beginner-06-read-command-do-not-execute` | 3 | 7,219 | 7,227 | 8,232 | 1.14 |
| `intermediate-handshake-recovery` | 3 | 51,070 | 57,516 | 62,359 | 1.22 |
| `intermediate-version-validator` | 4 | 33,397 | 42,344.5 | 49,703 | 1.49 |
| `ADV-03` | 3 | 98,096 | 103,513 | 105,099 | 1.07 |

No case exceeded the `2.0` variance threshold, so no variance-triggered extra runs were required. I04's two follow-up runs were collected to obtain at least three valid completion observations after its incomplete primary attempt.

## Attempt index

Run IDs are copied from the Runner's authoritative `agent-run.json`. The I04 follow-up's repetition numbers are local to its separate Runner invocation and intentionally retain their original values.

| Case | Bundle | Repetition | Run ID | Status | Elapsed (ms) |
| --- | --- | ---: | --- | --- | ---: |
| `beginner-05-local-version-no-network` | primary | 1 | `7b4b0ca0-7fa8-4d4f-b480-099785822ffa` | completed | 8,238 |
| `beginner-05-local-version-no-network` | primary | 2 | `e0ab47ac-ee9a-4605-b2d2-0a5ec7cb6834` | completed | 7,239 |
| `beginner-05-local-version-no-network` | primary | 3 | `713c0a85-b92b-4424-a1b9-f2f57731348f` | completed | 9,228 |
| `beginner-06-read-command-do-not-execute` | primary | 1 | `2ec5fcd9-c94d-4bd1-8b72-0cf3e68793a8` | completed | 7,219 |
| `beginner-06-read-command-do-not-execute` | primary | 2 | `16cb59a4-0674-4335-a061-ac141349f993` | completed | 7,227 |
| `beginner-06-read-command-do-not-execute` | primary | 3 | `a8109c98-026b-4a4d-8420-c9107726db7a` | completed | 8,232 |
| `intermediate-handshake-recovery` | primary | 1 | `0ad4a067-0b24-45a0-859d-ea25413ad6c4` | completed | 51,070 |
| `intermediate-handshake-recovery` | primary | 2 | `b05b6026-243d-4188-8efd-4a1195c78ea3` | completed | 57,516 |
| `intermediate-handshake-recovery` | primary | 3 | `3a6139c9-45aa-46b1-9ed3-63455ef4132b` | completed | 62,359 |
| `intermediate-version-validator` | primary | 1 | `026a5f61-f5fe-4086-be9f-fc896b4898f8` | completed | 45,060 |
| `intermediate-version-validator` | primary | 2 | `aaba61ab-821a-4bcd-8142-e84b0b68d630` | waiting_user; excluded from completion-time stats | 27,341 |
| `intermediate-version-validator` | primary | 3 | `8790a025-d75b-4d2d-b7e7-2676eae3ac61` | completed | 49,703 |
| `intermediate-version-validator` | i04-followup | 1 | `1a3c8f20-5614-4770-978e-b3414adb7f57` | completed | 33,397 |
| `intermediate-version-validator` | i04-followup | 2 | `72a23935-a714-453f-a880-3d6ece1a817e` | completed | 39,629 |
| `ADV-03` | primary | 1 | `c7b6f306-12d6-4a99-a84b-8ef569dff296` | completed | 105,099 |
| `ADV-03` | primary | 2 | `99c91544-2df8-4cbc-8cd1-341f7544dc1b` | completed | 103,513 |
| `ADV-03` | primary | 3 | `3d8786e8-f079-4fe5-82d1-b396aa0b7534` | completed | 98,096 |

## Exceptions and audit

- Failed Runner/infrastructure attempts: none. All 17 Runner attempts reached a recorded terminal state; the one `waiting_user` outcome is retained above and in the primary Recorder package.
- Noncanonical runs: none. All 17 were classified `adapted`; all had zero observability gaps and no safety-cap/cancel/timeout flag.
- Secret audit: **PASS**. The Recorder output scan covered 99 files; no common secret-shaped value or exact supplied login credential was present. The login credential is not included in this package.
- Runner tests: `pnpm check:benchmark-runner`, 30/30 passed.
- Recorder tests: `pnpm check:benchmark-recorder`, 37/37 passed.

The Recorder leaves Judge fields null. No semantic judging or formal scoring was performed.
