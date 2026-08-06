import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../src/config/presets';
import { smallMultiplesSyncEnabled, toggleSmallMultiplesSync } from '../src/query/smallMultiples';

test('small multiples cursor is enabled by default only for temporal charts', () => {
  assert.equal(smallMultiplesSyncEnabled(undefined, true), true);
  assert.equal(smallMultiplesSyncEnabled(true, true), true);
  assert.equal(smallMultiplesSyncEnabled(false, true), false);
  assert.equal(smallMultiplesSyncEnabled(undefined, false), false);
  assert.equal(smallMultiplesSyncEnabled(true, false), false);
});

test('small multiples cursor toggle persists explicit off and on states', () => {
  assert.equal(toggleSmallMultiplesSync(undefined), false);
  assert.equal(toggleSmallMultiplesSync(false), true);
  assert.equal(toggleSmallMultiplesSync(true), false);
});

test('risk preset explicitly enables the shared temporal cursor', () => {
  const preset = PRESETS.find(item => item.id === 'risk');
  assert.equal(preset?.config.chartType, 'small-multiples');
  assert.equal(preset?.config.smallMultiplesSyncCursor, true);
});
