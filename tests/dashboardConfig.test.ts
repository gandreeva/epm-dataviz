import test from'node:test';import assert from'node:assert/strict';
import{isValidSplitDate,migrateDashboard,normalizeSplitDateInput}from'../src/config/dashboard';
import{DEFAULT_PAGES}from'../src/config/presets';

test('splitDate accepts only real ISO calendar dates',()=>{assert.equal(isValidSplitDate('2026-07-01'),true);assert.equal(isValidSplitDate('2026-02-31'),false);assert.equal(isValidSplitDate(null),false)});
test('split date input stays ISO after selecting a native date',()=>{assert.equal(normalizeSplitDateInput('2026-08-03'),'2026-08-03');assert.equal(normalizeSplitDateInput('20260803'),'2026-08-03');assert.equal(normalizeSplitDateInput(''),null)});
test('migrating a legacy compact splitDate normalizes it to ISO',()=>{const migrated=migrateDashboard({version:1,pages:DEFAULT_PAGES,parameters:{splitDate:'20260803'}},DEFAULT_PAGES);assert.equal(migrated.parameters.splitDate,'2026-08-03')});
test('legacy page arrays migrate with an empty required global parameter',()=>{const migrated=migrateDashboard(DEFAULT_PAGES,DEFAULT_PAGES);assert.equal(migrated.parameters.splitDate,null);assert.equal(migrated.pages.length,DEFAULT_PAGES.length)});
test('dashboard payload preserves its saved splitDate',()=>{const migrated=migrateDashboard({version:1,pages:DEFAULT_PAGES,parameters:{splitDate:'2026-07-01'}},DEFAULT_PAGES);assert.equal(migrated.parameters.splitDate,'2026-07-01')});
test('legacy Waterfall settings reset to the empty Bridge v2 contract',()=>{const source=structuredClone(DEFAULT_PAGES),page=source.find(item=>item.id==='pnl-waterfall')!;page.config.waterfall={bindings:{stepsField:'step_key',valueField:'value',itemTypeField:'item_type',orderField:'item_order'}} as never;const migrated=migrateDashboard({version:1,pages:source,parameters:{splitDate:'2026-07-01'}},DEFAULT_PAGES),bridge=migrated.pages.find(item=>item.id==='pnl-waterfall')!.config.waterfall!;assert.equal(bridge.version,2);assert.equal(bridge.dimensionKey,null);assert.deepEqual(bridge.items,[])});
