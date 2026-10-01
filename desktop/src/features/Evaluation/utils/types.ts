import type {
  EvaluationDatasetConfig as ApiEvaluationDatasetConfig,
  EvaluationDatasetDocument as ApiEvaluationDatasetDocument,
  EvaluationDatasetRecord as ApiEvaluationDatasetRecord,
  EvaluationDatasetSample as ApiEvaluationDatasetSample,
  EvaluationDatasetValidationItem as ApiEvaluationDatasetValidationItem,
  EvaluationLogEntry as ApiEvaluationLogEntry,
  EvaluationMetricSummary as ApiEvaluationMetricSummary,
  EvaluationMode as ApiEvaluationMode,
  EvaluationRunRecord as ApiEvaluationRunRecord,
  EvaluationRunStatus,
  EvaluationSampleResult as ApiEvaluationSampleResult,
} from "@/shared/api/evaluation";

export type EvaluationMode = ApiEvaluationMode;

export type EvaluationJobStatus = "idle" | "ready" | EvaluationRunStatus;

export type ParsedDatasetDocument = ApiEvaluationDatasetDocument;

export type ParsedDatasetSample = ApiEvaluationDatasetSample;

export type ParsedDatasetValidationItem = ApiEvaluationDatasetValidationItem;

export type ParsedDatasetConfig = ApiEvaluationDatasetConfig;

export type ParsedDataset = ApiEvaluationDatasetRecord;

export type EvaluationLogEntry = ApiEvaluationLogEntry;

export type EvaluationMetricSummary = ApiEvaluationMetricSummary;

export type EvaluationSampleResult = ApiEvaluationSampleResult;

export type EvaluationRunRecord = ApiEvaluationRunRecord;
