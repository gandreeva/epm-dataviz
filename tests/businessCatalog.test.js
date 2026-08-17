import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';

const catalog = YAML.parse(fs.readFileSync(new URL('../config/business_catalog.yaml', import.meta.url), 'utf8'));
const sources = {
  credit_lifecycle: 'Выгрузка и ABC-системы на дату.csv',
  contract_terms: 'Условия по кредитным линиям.csv',
  key_rate_actual: 'Фактическая ключевая ставка.csv',
  key_rate_forecast: 'Прогноз ключевой ставки.csv',
  product_macro: 'Макроусловия по типу кредитного продукта.csv',
  multi_mapping_demo: 'multi_mapping_demo.csv',
};
test('catalog presentation metadata is defined in YAML', () => {
  assert.equal(catalog.frontend_catalog.groups.dimension, 'Аналитики');
  assert.equal(catalog.frontend_catalog.groups.measure, 'Показатели');
  Object.values(catalog.datasets).forEach(dataset => {
    assert.ok(dataset.title);
    assert.ok(dataset.description);
  });
});

test('all physical source fields are represented by semantic metadata', () => {
  for (const [datasetId, filename] of Object.entries(sources)) {
    const known = Object.keys(catalog.datasets[datasetId].fields || {});
    const headerLine = fs.readFileSync(new URL(`../data/${filename}`, import.meta.url), 'utf8').split(/\r?\n/, 1)[0];
    const delimiter = headerLine.includes(';') ? ';' : ',';
    const header = headerLine.split(delimiter).filter(Boolean);
    assert.deepEqual(header.filter(field => !known.includes(field)), [], datasetId);
  }
});

test('balance metadata is sourced from the payment schedule model', () => {
  const balance = catalog.datasets.credit_lifecycle.fields.balance;
  assert.equal(balance.field, 'balance');
  assert.equal(balance.title, 'Остаток на начало');
  assert.equal(balance.unit, 'currency');
});

test('lifecycle event projection and comment CSV follow the semantic contract', () => {
  const projection = catalog.datasets.credit_lifecycle.event_projection;
  assert.equal(projection.date_field, '0date');
  assert.deepEqual(Object.keys(projection.categories), ['loan', 'payment', 'rate']);
  assert.deepEqual(Object.values(projection.categories).map(item => item.rule), ['nonzero', 'nonzero', 'change']);
  const header = fs.readFileSync(new URL('../data/Комментарии к событиям.csv', import.meta.url), 'utf8').split(/\r?\n/, 1)[0];
  assert.equal(header, 'fin_version,fin_scenario,fin_doc_num,event_date,event_type,event_title,event_comment');
});

test('scenario member time roles are defined in the business catalog', () => {
  const members = catalog.datasets.key_rate_scenarios.fields.scenario_series.members;
  assert.equal(members.FCT.time_role, 'actual');
  assert.equal(members.BASE.time_role, 'forecast');
  assert.equal(members.OPTM.time_role, 'forecast');
});

test('scenario period is a catalog-defined day field with month and day hierarchies', () => {
  const period = catalog.datasets.key_rate_scenarios.fields.period;
  assert.equal(period.semantic_role, 'date');
  assert.equal(period.data_type, 'date');
  assert.equal(period.granularity, 'day');
  assert.deepEqual(period.hierarchies, ['YQHMD', 'YQM']);
});

test('canonical datasets define DuckDB transport and composed mappings', () => {
  assert.ok(catalog.datasets.key_rate_actual.source.url);
  assert.equal(catalog.datasets.key_rate_forecast.source.delimiter, ';');
  const composed = catalog.datasets.key_rate_scenarios;
  assert.equal(composed.type, 'composed');
  assert.deepEqual(composed.sources.map(item => item.role), ['actual', 'forecast']);
  assert.equal(composed.sources[0].mappings['0date'], 'period');
  assert.equal(composed.sources[0].constants.scenario_series, 'FCT');
});

test('financial reporting exposes only canonical mapped fields and its declared source', () => {
  const reporting = catalog.datasets.financial_reporting;
  assert.deepEqual(reporting.sources.map(item => item.dataset), ['writecube_fin_reports']);
  assert.deepEqual(Object.keys(reporting.fields), ['fin_acc', 'fin_version', 'fin_scenario', '0calmonth', 'value']);
  assert.equal(reporting.fields.fin_doc_num, undefined);
  assert.equal(reporting.fields.fin_acc.reference, 'fin_acc');
});

test('shared hierarchies are defined once in the canonical catalog', () => {
  assert.deepEqual(catalog.hierarchies.YQHMD.levels.map(item => item.key), ['YEAR', 'HALF_YEAR', 'QUARTER', 'MONTH', 'DAY']);
  assert.deepEqual(catalog.datasets.key_rate_scenarios.fields.period.hierarchies, ['YQHMD', 'YQM']);
});

test('legacy metadata sections are no longer part of the runtime catalog', () => {
  assert.equal(catalog.frontend_datasets, undefined);
  assert.equal(catalog.business_objects, undefined);
  assert.equal(catalog.datasets.credit_lifecycle.fields['0date'].data_type, 'date');
  assert.deepEqual(catalog.datasets.credit_lifecycle.fields['0date'].hierarchies, ['YQMD']);
});
