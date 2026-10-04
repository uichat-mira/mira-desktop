# Agent Core Benchmark scoring (#224)

agent-core-scorer.mjs is the post-Recorder scoring layer for the frozen Core v0.1 contract.

It keeps deterministic and semantic ownership separate:

- deterministic evaluators consume frozen Recorder evidence;
- timing credit follows the fixed #216 schedule;
- hard-fail mechanically forces official Task Success to 0;
- fresh blank Judge results may populate only scorer: judge criteria;
- diagnostic/untimed cases never receive invented timing credit;
- Pilot mode requires one complete comparable repetition and never claims Stable@3 / Complete@3;
- Formal mode requires three complete comparable repetitions per scored case.

Current #224 Pilot evaluators cover B02, B07, I08, and ADV-08. --coverage-only reports the remaining formal-case evaluator gap explicitly; unsupported cases are never silently excluded.

Examples:

    pnpm benchmark:score -- --report <report-dir> --mode pilot
    pnpm benchmark:score -- --report <report-dir> --mode pilot --judge-results <judge-results.json>
    pnpm benchmark:score -- --coverage-only
    pnpm benchmark:audit -- --report <report-dir> --out <report-dir>/package-audit.json

Judge result file shape:

    {
      "repetitions": [
        {
          "caseId": "intermediate-health-status-call-chain",
          "repetition": 1,
          "semanticResults": [
            {
              "questionId": "J1",
              "criterionId": "C1",
              "outcome": "pass",
              "evidenceRefs": ["artifact:final-answer", "trajectory:42"]
            }
          ]
        }
      ]
    }
