import { mcpBadRequest } from "../core/errors.js";

export const parseOffset = (value: unknown) => {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw mcpBadRequest("offset must be a non-negative integer");
  }
  return value;
};

export const parseBoundedLimit = (
  value: unknown,
  input: { defaultValue: number; maxValue: number },
) => {
  if (value === undefined) return input.defaultValue;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw mcpBadRequest("limit must be a positive integer");
  }
  return Math.min(value, input.maxValue);
};

export const buildContinuation = (input: {
  offset: number;
  returnedCount: number;
  totalCount?: number;
  hasMore?: boolean;
}) => {
  const hasMore =
    input.hasMore ??
    (typeof input.totalCount === "number"
      ? input.offset + input.returnedCount < input.totalCount
      : false);

  return {
    offset: input.offset,
    returnedCount: input.returnedCount,
    hasMore,
    truncated: hasMore,
    ...(hasMore
      ? { nextOffset: input.offset + input.returnedCount }
      : {}),
  };
};
