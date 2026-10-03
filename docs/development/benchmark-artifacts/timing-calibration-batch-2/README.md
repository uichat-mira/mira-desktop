# Timing Calibration Batch 2 (#220)

This frozen Recorder package contains real #221 Runner and #223 Recorder output
for the five requested cases. It is calibration evidence only: no formal
Benchmark score is reported, and the case contract remains unchanged.

All valid observations used for timing are `completed`, `adapted`, and
comparable on the same local host (`darwin/x64`, Node `v22.22.3`, provider
`default`). `T_soft` and `T_hard` remain unset in RC1; elapsed values are
recorded without timing credit or timeout classification.

| Case | Valid reps | Min (ms) | Median (ms) | Max (ms) | Max/min |
| --- | ---: | ---: | ---: | ---: | ---: |
| `beginner-03-find-retry-window-references` | 3 | 6,280 | 6,770 | 8,285 | 1.32 |
| `beginner-04-read-only-telemetry-state` | 3 | 6,737 | 7,264 | 9,255 | 1.37 |
| `intermediate-production-retry-only` | 5 | 28,481 | 93,976 | 175,582 | 6.16 |
| `ADV-01` | 5 | 58,350 | 83,230 | 196,140 | 3.36 |
| `ADV-02` | 3 | 69,748 | 73,805 | 97,776 | 1.40 |

The two cases whose initial `max/min` exceeded 2.0 received two supplemental
observations each, as required by #220. `ADV-02` had one failed first
observation (`failed_error`); it is retained in the raw evidence but excluded
from the three valid comparable timing observations, and one supplemental run
was added to reach three valid observations.

Execution classification was recorded per repetition. No observation was
classified `noncanonical`; all valid timing observations were `adapted` on
macOS Intel with the same HTTP control surface, model path, fixture, governance
and observability semantics.

Secret audit: no password, API key, Bearer token, private-key block, or token
prefix was found in the frozen package. Judge fields remain null; the
Recorder's schema-level deterministic fields are retained, but no formal
Benchmark score is reported.
