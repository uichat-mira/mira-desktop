import { isWenshuCapabilityPackProvisioned } from "@/microapps/office-suite/capability-pack.js";
import {
  listToolDefinitions,
  unregisterTool,
} from "./registry.js";

/**
 * Legacy WenShu wrapper tool ids retained only so bootstrap/reconciliation can
 * remove stale registrations created by older runtime paths.
 *
 * DOCX/PDF/PPTX/XLSX are exposed through the Skill registry. Their internal
 * runtimes/scripts must not be duplicated as Planner-visible Harness tools.
 */
export const WENSHU_OPTIONAL_CAPABILITY_IDS = [
  "office_document",
  "office_pdf",
  "office_spreadsheet",
  "office_presentation",
] as const;

export const reconcileWenshuOfficeHarnessCapabilities = () => {
  const available = isWenshuCapabilityPackProvisioned();
  const registered = new Set(listToolDefinitions().map((definition) => definition.id));

  for (const id of WENSHU_OPTIONAL_CAPABILITY_IDS) {
    if (registered.has(id)) unregisterTool(id);
  }

  return {
    runtimePackAvailable: available,
    capabilityIds: [],
    registeredCapabilityIds: [],
  };
};
