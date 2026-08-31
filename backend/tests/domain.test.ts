import test from 'node:test';
import assert from 'node:assert/strict';
import { localParts, monthBounds, nextScheduledRun } from '../src/lib/family-time';
import { effectiveRewardCost, rewardAvailability } from '../src/lib/reward-rules';

test('family timezone produces the expected local calendar date', () => {
  const taipei = localParts(new Date('2026-08-30T16:30:00.000Z'), 'Asia/Taipei');
  assert.equal(taipei.date, '2026-08-31');
  assert.equal(taipei.time, '00:30');
});

test('weekend and exact-date reward rules use family-local time', () => {
  const weekend = rewardAvailability({ availabilityMode: 'WEEKENDS', availableStartTime: null, availableEndTime: null, availableDates: [] }, 'Asia/Taipei', new Date('2026-08-30T04:00:00.000Z'));
  assert.equal(weekend.available, true);
  const exact = rewardAvailability({ availabilityMode: 'DATES', availableStartTime: '09:00', availableEndTime: '20:00', availableDates: [{ date: '2026-08-31' }] }, 'Asia/Taipei', new Date('2026-08-31T02:00:00.000Z'));
  assert.equal(exact.available, true);
});

test('reward time window blocks a request outside the window', () => {
  const result = rewardAvailability({ availabilityMode: 'ALWAYS', availableStartTime: '09:00', availableEndTime: '20:00', availableDates: [] }, 'Asia/Taipei', new Date('2026-08-31T00:00:00.000Z'));
  assert.equal(result.available, false);
  assert.match(result.reason ?? '', /開放時段/);
});

test('discount calculation rounds required points upward', () => {
  assert.equal(effectiveRewardCost({ cost: 11, discountPercent: 20, discountStart: null, discountEnd: null }), 9);
});

test('weekly scheduling respects selected local weekday and time', () => {
  const next = nextScheduledRun({ frequency: 'weekly', localTime: '09:00', weekday: 1, dayOfMonth: null }, 'Asia/Taipei', new Date('2026-08-30T00:00:00.000Z'));
  assert.equal(next.toISOString(), '2026-08-31T01:00:00.000Z');
});

test('natural month bounds use the family timezone', () => {
  const bounds = monthBounds('2026-08', 'Asia/Taipei');
  assert.equal(bounds.start.toISOString(), '2026-07-31T16:00:00.000Z');
  assert.equal(bounds.end.toISOString(), '2026-08-31T16:00:00.000Z');
});
