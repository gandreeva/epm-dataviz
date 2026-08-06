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
};
const fieldValue = value => typeof value === 'string' ? value : value.field;

test('catalog presentation metadata is defined in YAML', () => {
  assert.equal(catalog.frontend_catalog.groups.dimension, 'Аналитики');
  assert.equal(catalog.frontend_catalog.groups.measure, 'Показатели');
  Object.values(catalog.frontend_datasets).forEach(dataset => {
    assert.ok(dataset.title);
    assert.ok(dataset.description);
  });
});

test('all physical source fields are represented by semantic metadata', () => {
  for (const [datasetId, filename] of Object.entries(sources)) {
    const binding = catalog.frontend_datasets[datasetId];
    const source = catalog.business_objects[binding.business_object].epm;
    const known = [...Object.values(source.dimensions), ...Object.values(source.measures)].map(fieldValue);
    const header = fs.readFileSync(new URL(`../data/${filename}`, import.meta.url), 'utf8').split(/\r?\n/, 1)[0].split(',');
    assert.deepEqual(header.filter(field => !known.includes(field)), [], datasetId);
  }
});

test('balance metadata is sourced from the payment schedule model', () => {
  const balance = catalog.business_objects.payment_schedule.epm.measures.balance;
  assert.deepEqual(balance, {field:'balance', title:'Остаток на начало', unit:'currency'});
});

test('lifecycle event projection and comment CSV follow the semantic contract', () => {
  const projection = catalog.frontend_datasets.credit_lifecycle.event_projection;
  assert.equal(projection.date_field, '0date');
  assert.deepEqual(Object.keys(projection.categories), ['loan', 'payment', 'rate']);
  assert.deepEqual(Object.values(projection.categories).map(item => item.rule), ['nonzero', 'nonzero', 'change']);
  const header = fs.readFileSync(new URL('../data/Комментарии к событиям.csv', import.meta.url), 'utf8').split(/\r?\n/, 1)[0];
  assert.equal(header, 'fin_version,fin_scenario,fin_doc_num,event_date,event_type,event_title,event_comment');
});

test('scenario member time roles are defined in the business catalog', () => {
  const members = catalog.frontend_datasets.key_rate_scenarios.field_overrides.scenario_series.members;
  assert.equal(members.FCT.time_role, 'actual');
  assert.equal(members.BASE.time_role, 'forecast');
  assert.equal(members.OPTM.time_role, 'forecast');
});

test('scenario period is a catalog-defined calmonth with two time hierarchies', () => {
  const period = catalog.frontend_datasets.key_rate_scenarios.field_overrides.period;
  assert.equal(period.semantic_role, 'calmonth');
  assert.equal(period.data_type, 'date');
  assert.equal(period.granularity, 'month');
  assert.deepEqual(period.hierarchies.map(item => item.id), ['YQHMD', 'YQM']);
  assert.deepEqual(period.hierarchies[0].levels.map(item => item.key), ['YEAR', 'HALF_YEAR', 'QUARTER', 'MONTH']);
  assert.deepEqual(period.hierarchies[1].levels.map(item => item.key), ['YEAR', 'QUARTER', 'MONTH']);
});
