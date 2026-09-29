import type { InputField } from "@openbot/contracts";
import { describe, expect, it } from "vitest";
import { missingRequired } from "./inputs";

const fields = [
  { id: "name", label: "Name", type: "text", required: true, multiline: false },
  { id: "count", label: "Count", type: "number", required: true },
  {
    id: "tags",
    label: "Tags",
    type: "choice",
    required: true,
    options: ["a", "b"],
    multiple: true,
    allowOther: false,
  },
  { id: "ok", label: "OK?", type: "confirm", required: true },
  { id: "note", label: "Note", type: "text", required: false, multiline: false },
] as InputField[];

describe("missingRequired", () => {
  it("lists required fields without a usable answer", () => {
    expect(missingRequired(fields, {})).toEqual(["Name", "Count", "Tags", "OK?"]);
    expect(missingRequired(fields, { name: "  ", count: Number.NaN, tags: [], ok: false })).toEqual(
      ["Name", "Count", "Tags"],
    );
    expect(missingRequired(fields, { name: "Ada", count: 0, tags: ["a"], ok: false })).toEqual([]);
  });
});
