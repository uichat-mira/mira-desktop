/**
 * @deprecated Import the explicit text-JSON compatibility codec from
 * `./text-json-codec` in new code. These exports preserve existing Planner
 * callers while E01-2 moves provider decoding behind the decision adapter.
 */
export {
  parseNextActionPlannerOutput,
  parseNextActionPlannerOutputWithDiagnostics,
} from "./text-json-codec";
export type { PlannerOutputParseResult } from "./text-json-codec";
