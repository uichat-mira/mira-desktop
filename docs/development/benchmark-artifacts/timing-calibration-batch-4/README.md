# Timing Calibration Batch 4 (#220)

Timing observations only. This package contains no formal score, semantic Judge result, or frozen timing cutoff. Recorder judge fields remain null; `T_soft` and `T_hard` remain null.

## Identity and Procedure

- Repository: `uichat-mira/mira-desktop`
- Mira source commit: `21c826fac0d65ebd74671bd122713891b900c53b`
- Case set: `core-v0.1-rc1`; frozen selection: [`selection.json`](selection.json)
- Runner and Recorder inputs: five selected cases, 15 primary attempts, then four additional B08/I05 attempts in a separate invocation so repetition IDs remain unchanged.
- Backend: local Mira backend on `127.0.0.1:8799`, backed by a consistent SQLite copy under the ignored `.test-artifact/` directory; the normal development database was not used for benchmark execution.
- Host: macOS `darwin/x64`, OS release `24.6.0`, Node `v22.22.3`. All runs are `adapted`, not canonical Windows runs.
- Provider: `default`. Model ID was observed as `deepseek-v4.1-flash` for nine runs and is unknown for the ten B08/I05 runs.
- The Runner safety bound was `900000` ms; it is a liveness guard, not a benchmark cutoff. All runs have null `T_soft`/`T_hard`, no safety-cap hit, no soft/hard cutoff, and zero Runner observability gaps.

## Timing Observations

Elapsed values below cover every Recorder-classified valid comparable terminal observation, including `waiting_user`. For those rows, elapsed is time to the recorded terminal response, not a successful completion time.

| Case | Valid comparable | Completed | Min (ms) | Median (ms) | Max (ms) | Max/min |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `beginner-07-rename-one-file` | 3 | 3 | 8,378 | 9,269 | 10,341 | 1.23 |
| `beginner-08-contextual-config-follow-up` | 5 | 0 | 11,313 | 12,288 | 13,308 | 1.18 |
| `intermediate-inspect-then-continue` | 5 | 0 | 32,531 | 44,504 | 49,392 | 1.52 |
| `ADV-04` | 3 | 3 | 111,422 | 136,867 | 155,330 | 1.39 |
| `ADV-05` | 3 | 3 | 81,098 | 84,393 | 94,188 | 1.16 |

No case exceeded the `2.0` max/min threshold, so no variance-triggered extra observations were required. B08 and I05 each received two additional stability observations after all three primary repetitions ended at `waiting_user`; those extra observations were not prompted by the variance rule. All five observations for each remain Recorder-classified valid comparable runs, but none reached `completed`.

## Multi-turn Observations

B08 and I05 used only the frozen selection's `when: "completed"` follow-up text. The Runner recorded one `user_reply` intervention per attempt with the exact selection text; no extra prompt, hint, or solution information was supplied.

All five B08 attempts ended `waiting_user`; the final response asked which context `timeoutMs` referred to despite the prior turn. All five I05 attempts ended `waiting_user`; the final response said the earlier minimal fix was not available in context and requested it again. These are recorded terminal outcomes, not silently dropped infrastructure failures. No semantic scoring was performed.

## Attempt Index

Run IDs below are authoritative IDs from Runner `agent-run.json`. Supplement repetitions intentionally remain in their separate Recorder package because their local repetition numbers restart at 1.

| Bundle | Case | Rep | Run ID | Terminal | Elapsed (ms) |
| --- | --- | ---: | --- | --- | ---: |
| primary | `beginner-07-rename-one-file` | 1 | `e487819f-2a9e-4455-95c7-3ffc6fde9519` | completed | 10,341 |
| primary | `beginner-07-rename-one-file` | 2 | `2f5e6caf-1daa-4a08-bacc-3a073007c6ca` | completed | 8,378 |
| primary | `beginner-07-rename-one-file` | 3 | `ce7616bf-8249-4d1e-b5f4-a8ee23422dbd` | completed | 9,269 |
| primary | `beginner-08-contextual-config-follow-up` | 1 | `9c841240-0e30-4f85-add2-87397e7f0c8e` | waiting_user | 13,292 |
| primary | `beginner-08-contextual-config-follow-up` | 2 | `9d0ade95-55e4-462a-9891-1703e78b46c7` | waiting_user | 12,288 |
| primary | `beginner-08-contextual-config-follow-up` | 3 | `447cb9df-95bb-4be4-9c33-a2773893b914` | waiting_user | 11,313 |
| primary | `intermediate-inspect-then-continue` | 1 | `1fa8c82b-30d1-4e97-8646-c9378b07f069` | waiting_user | 32,531 |
| primary | `intermediate-inspect-then-continue` | 2 | `9da62111-8cb5-455e-86b2-499026ca4a8b` | waiting_user | 44,504 |
| primary | `intermediate-inspect-then-continue` | 3 | `4c6cd671-c346-4ece-95e3-387694bb2057` | waiting_user | 49,392 |
| primary | `ADV-04` | 1 | `707d0018-4457-4060-bc84-4a0ee849be50` | completed | 111,422 |
| primary | `ADV-04` | 2 | `20eafad3-97d1-4fc2-9d5f-83d45790b94d` | completed | 155,330 |
| primary | `ADV-04` | 3 | `d15f0f9d-b934-4733-95f7-9f5375c2dfe5` | completed | 136,867 |
| primary | `ADV-05` | 1 | `d6f3b12a-161b-4a2c-82f0-0befb5863d8e` | completed | 81,098 |
| primary | `ADV-05` | 2 | `0dd7033a-2283-418d-84b2-a6f5fd1ee799` | completed | 94,188 |
| primary | `ADV-05` | 3 | `e6c43dd1-fc20-465c-9b83-8d013b614a36` | completed | 84,393 |
| stability check | `beginner-08-contextual-config-follow-up` | 1 | `78953fec-b3d7-429e-ab0f-c42dc0a725bd` | waiting_user | 13,308 |
| stability check | `beginner-08-contextual-config-follow-up` | 2 | `4342f128-6e16-4682-81eb-8db5f6527ba2` | waiting_user | 12,288 |
| stability check | `intermediate-inspect-then-continue` | 1 | `618de616-3e03-4db3-921b-4c0283f4a16b` | waiting_user | 43,908 |
| stability check | `intermediate-inspect-then-continue` | 2 | `cc1a53bf-fb9b-4436-93c2-a0186b83afcd` | waiting_user | 48,950 |

## Exceptions and Audit

- Runner attempts: 19 total; 9 `completed`, 10 `waiting_user`; no failed Runner process, safety-cap termination, or noncanonical execution. Every attempt is retained in Recorder snapshots and listed above.
- Recorder unresolved diagnostics for ADV-04/ADV-05 include child-failure visibility and `failureKind`; these do not affect the recorded monotonic elapsed measurements.
- The generated Recorder timing-gap wording still says final timing is gated on canonical Windows evidence. That text is stale relative to the current platform-neutral #220 policy; it is preserved in generated output and called out here, not silently rewritten. No timing cutoff was inferred.
- Secret audit: **PASS**. The artifact tree was scanned for the exact supplied login password and common key/token/Bearer/private-key patterns; no matches were found. Credentials and the SQLite database copy are excluded from this package.
- Runner tests: `pnpm check:benchmark-runner`, 30/30 passed.
- Recorder tests: `pnpm check:benchmark-recorder`, 37/37 passed.

Recorder artifacts are in [`primary/`](primary/) and [`multiturn-followup/`](multiturn-followup/). Each contains its manifest, summary, report, public projection, case contracts, per-repetition records, trajectories, Judge inputs, and raw snapshots.
