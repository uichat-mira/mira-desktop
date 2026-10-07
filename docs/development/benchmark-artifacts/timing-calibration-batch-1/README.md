# Timing Calibration Batch 1 (#220)

This frozen Recorder package contains the #221 Runner and #223 Recorder output
for the five requested cases. It is calibration evidence only: no formal
Benchmark score is included, and the case contract remains unchanged.

All 17 included repetitions are `completed`, `adapted`, and comparable on the
same local host (`darwin/x64`, Node `v22.22.3`, model `deepseek-v4.1-flash`,
provider `default`). `T_soft` and `T_hard` remain unset because the RC contract
requires canonical Windows evidence; elapsed values are recorded without timing
credit or timeout classification.

| Case | Valid reps | Min (ms) | Median (ms) | Max (ms) | Max/min |
| --- | ---: | ---: | ---: | ---: | ---: |
| `beginner-01-concise-rewrite` | 3 | 4,223 | 4,733 | 6,736 | 1.60 |
| `beginner-02-locate-release-checklist` | 3 | 6,240 | 7,243 | 10,269 | 1.65 |
| `intermediate-effective-prod-timeout` | 5 | 29,802 | 114,234 | 393,317 | 13.20 |
| `intermediate-health-status-call-chain` | 3 | 30,408 | 31,937 | 34,543 | 1.14 |
| `ADV-08` | 3 | 53,138 | 70,146 | 83,502 | 1.57 |

The timeout case exceeded the `max/min > 2` rule, so two supplemental
repetitions were added. No `T_soft`/`T_hard` values were invented. The raw
snapshots and per-repetition evidence are retained for offline replay.

Secret audit: no password, API key, Bearer token, credential field, or token
prefix was found in the frozen package. The report contains no formal score.
