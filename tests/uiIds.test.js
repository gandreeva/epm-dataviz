import test from 'node:test';
import assert from 'node:assert/strict';
import { UI_IDS, UI_ID_PATTERN } from '../src/uiIds.js';

const collect = (value, output = []) => {
  if (typeof value === 'string') output.push(value);
  else if (value && typeof value === 'object') Object.values(value).forEach(item => collect(item, output));
  return output;
};

test('all static UI IDs follow the public naming convention', () => {
  const ids = collect(UI_IDS);
  assert.ok(ids.length > 20);
  ids.forEach(id => assert.match(id, UI_ID_PATTERN));
  assert.equal(new Set(ids).size, ids.length);
});

test('dynamic UI IDs are stable and contain business keys', () => {
  assert.equal(UI_IDS.catalog.field('total-payment'), 'catalog.field.total-payment');
  assert.equal(UI_IDS.canvas.renderer('line'), 'canvas.renderer.line');
  assert.equal(UI_IDS.design.chartType('pie'), 'chart-type.pie');
  assert.equal(UI_IDS.legendSeries('series_0'), 'legend.series.series_0');
  assert.equal(UI_IDS.seriesSetting('series_0'), 'series-setting.series_0.visibility');
  assert.equal(UI_IDS.seriesSetting('series_0','color-custom'), 'series-setting.series_0.color-custom');
  assert.equal(UI_IDS.metricSetting('total_payment','axis-right'), 'metric-setting.total_payment.axis-right');
  assert.equal(UI_IDS.mapping.series, 'mapping.series-settings');
  assert.equal(UI_IDS.mapping.filterToggle('period'), 'mapping.filter-toggle.period');
  assert.equal(UI_IDS.catalog.filterToggle('period'), 'catalog.filter-toggle.period');
  assert.equal(UI_IDS.pageFilters.control('period'), 'page-filter.period');
  assert.equal(UI_IDS.pageFilters.splitDate, 'page-filter.split-date');
  assert.equal(UI_IDS.actualForecast.root, 'mapping.actual-forecast');
  assert.equal(UI_IDS.actualForecast.divider, 'chart.actual-forecast.divider');
  assert.equal(UI_IDS.eventMarker('2025'), 'event.marker.2025');
  assert.equal(UI_IDS.eventCluster('2025-2'), 'event.cluster.2025-2');
  assert.equal(UI_IDS.eventGuide('loan-2025'), 'event.guide.loan-2025');
  assert.equal(UI_IDS.eventCategoryRow('loan'), 'event.category-row.loan');
  assert.equal(UI_IDS.eventCategory('loan'), 'event.category.loan');
  assert.equal(UI_IDS.eventLegend, 'event.legend');
  assert.equal(UI_IDS.eventCrosshair, 'event.crosshair');
  assert.equal(UI_IDS.eventTooltip, 'event.tooltip');
  assert.equal(UI_IDS.timeSeriesTooltip, 'chart.tooltip.time-series');
  assert.equal(UI_IDS.mapping.smallMultiplesSync, 'mapping.series-settings.small-multiples-sync');
  assert.equal(UI_IDS.smallMultiplesCursor('rwa_loan'), 'chart.small-multiples.cursor.rwa_loan');
  assert.equal(UI_IDS.smallMultiplesTooltip('rwa_loan'), 'chart.small-multiples.tooltip.rwa_loan');
  assert.equal(UI_IDS.mapping.specializedBucket('threshold.actual'), 'mapping.specialized.threshold-actual');
  assert.equal(UI_IDS.threshold.marker('actual'), 'chart.threshold-comparison.marker.actual');
  assert.equal(UI_IDS.rolling.marker('20250901'), 'chart.rolling-forecast.marker.20250901');
  assert.equal(UI_IDS.rolling.targetMarker('20260901'), 'chart.rolling-forecast.target-marker.20260901');
  assert.equal(UI_IDS.waterfall.item('net_income'), 'chart.waterfall.item.net_income');
  assert.equal(UI_IDS.waterfall.label('net_income'), 'chart.waterfall.label.net_income');
  assert.equal(UI_IDS.waterfall.connector('revenue'), 'chart.waterfall.connector.revenue');
  assert.equal(UI_IDS.waterfall.sequenceRow('pnl-revenue'), 'mapping.waterfall.sequence-row.pnl-revenue');
  assert.equal(UI_IDS.waterfall.action('pnl-revenue'), 'mapping.waterfall.action.pnl-revenue');
  assert.equal(UI_IDS.waterfall.measure('pnl-revenue'), 'mapping.waterfall.measure.pnl-revenue');
  assert.equal(UI_IDS.waterfall.reorder('pnl-revenue','up'), 'mapping.waterfall.reorder.pnl-revenue.up');
  assert.equal(UI_IDS.waterfall.summary, 'mapping.waterfall.summary');
  assert.equal(UI_IDS.waterfall.settingsOpen, 'mapping.waterfall.settings-open');
  assert.equal(UI_IDS.waterfall.dialog, 'mapping.waterfall.dialog');
  assert.equal(UI_IDS.waterfall.dialogApply, 'mapping.waterfall.dialog.apply');
  assert.equal(UI_IDS.waterfall.dialogCancel, 'mapping.waterfall.dialog.cancel');
  assert.equal(UI_IDS.waterfall.terminal('pnl-net-income'), 'chart.waterfall.terminal.pnl-net-income');
  assert.equal(UI_IDS.waterfall.reconciliationSummary, 'chart.waterfall.reconciliation-summary');
  assert.equal(UI_IDS.waterfall.reconciliationSummaryRow('pnl-ebitda'), 'chart.waterfall.reconciliation-summary-row.pnl-ebitda');
  assert.equal(UI_IDS.waterfall.showReconciliationSummary, 'mapping.waterfall.show-reconciliation-summary');
});

test('dynamic keys are normalized without locale-dependent text', () => {
  assert.equal(UI_IDS.catalog.field('Contract Number'), 'catalog.field.contract-number');
  assert.match(UI_IDS.catalog.field('Contract Number'), UI_ID_PATTERN);
});
