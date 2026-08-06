import test from "node:test";
import assert from "node:assert/strict";
import type {
  BridgeSequenceAction,
  BridgeSequenceConfig,
  Dataset,
} from "../src/types";
import {
  buildWaterfall,
  DEFAULT_WATERFALL_SETTINGS,
  validateBridgeSequence,
} from "../src/query/specializedCharts";

const dataset: Dataset = {
  id: "pnl_waterfall",
  label: "Balance bridge",
  description: "",
  fields: [
    { id: "account", label: "Счёт", kind: "dimension", unit: "text" },
    { id: "opening_balance", label: "Начальный остаток", kind: "measure", unit: "currency" },
    { id: "debit", label: "Дебет", kind: "measure", unit: "currency" },
    { id: "credit", label: "Кредит", kind: "measure", unit: "currency" },
    { id: "closing_balance", label: "Остаток", kind: "measure", unit: "currency" },
  ],
  rows: [
    { account: "opening", opening_balance: 60 },
    { account: "opening", opening_balance: 40 },
    { account: "debit", debit: 30 },
    { account: "credit", credit: -20 },
    { account: "closing", closing_balance: 110 },
  ],
};

const item = (
  id: string,
  memberKey: string,
  measureKey: string,
  action: BridgeSequenceAction,
  order: number,
) => ({
  id,
  memberKey,
  displayLabel: memberKey,
  measureKey,
  measureLabel: measureKey,
  action,
  order,
  enabled: true,
});
const config = (items: BridgeSequenceConfig["items"]): BridgeSequenceConfig => ({
  ...DEFAULT_WATERFALL_SETTINGS,
  dimensionKey: "account",
  availableMeasureKeys: [
    "opening_balance",
    "debit",
    "credit",
    "closing_balance",
  ],
  defaultMeasureKey: "opening_balance",
  items,
});

test("balance bridge supports a different measure per member and SUM resolution", () => {
  const result = buildWaterfall(
    dataset,
    dataset.rows,
    config([
      item("open", "opening", "opening_balance", "opening", 1),
      item("debit", "debit", "debit", "add", 2),
      item("credit", "credit", "credit", "subtract", 3),
      item("close", "closing", "closing_balance", "checkpoint", 4),
    ]),
  );
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.model?.items[0].signedValue, 100);
  assert.equal(result.model?.items[1].runningAfter, 130);
  assert.equal(result.model?.items[2].signedValue, -20);
  assert.equal(result.model?.items[2].displayValue, -20);
  assert.equal(result.model?.items[2].runningAfter, 110);
  assert.equal(result.model?.items[3].difference, 0);
  assert.equal(result.model?.items[3].displayValue, 110);
  assert.equal(result.model?.items[3].isTerminalCheckpoint, true);
});

test("a mismatched checkpoint warns but never resets the running balance", () => {
  const mismatch: Dataset = {
    ...dataset,
    rows: [
      { account: "opening", opening_balance: 100 },
      { account: "reported", closing_balance: 95 },
      { account: "debit", debit: 10 },
      { account: "closing", closing_balance: 110 },
    ],
  };
  const result = buildWaterfall(
    mismatch,
    mismatch.rows,
    config([
      item("open", "opening", "opening_balance", "opening", 1),
      item("reported", "reported", "closing_balance", "checkpoint", 2),
      item("debit", "debit", "debit", "add", 3),
      item("close", "closing", "closing_balance", "checkpoint", 4),
    ]),
  );
  assert.equal(result.model?.items[1].difference, -5);
  assert.equal(result.model?.items[1].runningAfter, 100);
  assert.equal(result.model?.items[2].runningBefore, 100);
  assert.equal(result.model?.items.at(-1)?.difference, 0);
  assert.ok(result.warnings.some((warning) => warning.includes("reported")));
});

test("structural validation rejects movements before opening and incompatible units", () => {
  const incompatible: Dataset = {
    ...dataset,
    fields: [
      ...dataset.fields,
      { id: "ratio", label: "Ratio", kind: "measure", unit: "percent" },
    ],
  };
  const validation = validateBridgeSequence(
    incompatible,
    config([
      item("debit", "debit", "ratio", "add", 1),
      item("open", "opening", "opening_balance", "opening", 2),
      item("close", "closing", "closing_balance", "checkpoint", 3),
    ]),
  );
  assert.ok(validation.blockingErrors.some((error) => error.includes("до строки Начало")));
  assert.ok(validation.blockingErrors.some((error) => error.includes("units")));
});

test("missing movement source values are rendered as zero without changing running balance", () => {
  const result = buildWaterfall(
    dataset,
    dataset.rows,
    config([
      item("open", "opening", "opening_balance", "opening", 1),
      item("missing", "absent", "debit", "add", 2),
      item("close", "closing", "closing_balance", "checkpoint", 3),
    ]),
  );
  assert.ok(result.model);
  assert.equal(result.model?.items[1].signedValue, 0);
  assert.equal(result.model?.items[1].height, 0);
  assert.equal(result.model?.items[1].runningBefore, result.model?.items[1].runningAfter);
  assert.equal(result.model?.items[1].valueSource, "missing");
  assert.ok(result.warnings.some((warning) => warning.includes("принято 0")));
});

test("missing opening value remains blocking", () => {
  const result = buildWaterfall(dataset, dataset.rows, config([
    item("open", "absent", "opening_balance", "opening", 1),
    item("close", "closing", "closing_balance", "checkpoint", 2),
  ]));
  assert.equal(result.model, undefined);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("absent")));
});

test("missing checkpoint displays calculated running balance", () => {
  const result = buildWaterfall(dataset, dataset.rows, config([
    item("open", "opening", "opening_balance", "opening", 1),
    item("debit", "debit", "debit", "add", 2),
    item("missing-checkpoint", "absent", "closing_balance", "checkpoint", 3),
  ]));
  const checkpoint = result.model?.items.at(-1);
  assert.ok(checkpoint);
  assert.equal(checkpoint.reportedValue, null);
  assert.equal(checkpoint.calculatedValue, 130);
  assert.equal(checkpoint.displayValue, 130);
  assert.equal(checkpoint.valueSource, "calculated");
  assert.equal(checkpoint.runningBefore, checkpoint.runningAfter);
});
