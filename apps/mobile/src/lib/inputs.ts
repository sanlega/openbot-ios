import type { InputAnswer, InputField } from "@openbot/contracts";

/** Labels of required fields that have no usable answer yet. */
export function missingRequired(
  fields: InputField[],
  answers: Record<string, InputAnswer | undefined>,
): string[] {
  return fields
    .filter((field) => field.required)
    .filter((field) => {
      const value = answers[field.id];
      if (value === undefined || value === null) return true;
      if (typeof value === "string") return value.trim() === "";
      if (typeof value === "number") return Number.isNaN(value);
      if (Array.isArray(value)) return value.length === 0;
      return false;
    })
    .map((field) => field.label);
}
