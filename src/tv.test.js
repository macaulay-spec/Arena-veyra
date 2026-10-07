import test from 'node:test';
import assert from 'node:assert/strict';
import { nextFocusTarget } from './tv.js';

const element = (name, left, top, width = 100, height = 100) => ({
  name,
  disabled: false,
  getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }),
});

const a = element('a', 0, 0);
const b = element('b', 200, 0);
const c = element('c', 0, 200);
const d = element('d', 200, 200);
const grid = [a, b, c, d];

test('left and right move within a row', () => {
  assert.equal(nextFocusTarget(grid, a, 'right').name, 'b');
  assert.equal(nextFocusTarget(grid, b, 'left').name, 'a');
  assert.equal(nextFocusTarget(grid, c, 'right').name, 'd');
});

test('up and down move between rows', () => {
  assert.equal(nextFocusTarget(grid, a, 'down').name, 'c');
  assert.equal(nextFocusTarget(grid, d, 'up').name, 'b');
});

test('focus wraps at the edges instead of getting stuck', () => {
  assert.equal(nextFocusTarget(grid, b, 'right').name, 'a', 'right at the end wraps to the start of the row');
  assert.equal(nextFocusTarget(grid, a, 'left').name, 'b', 'left at the start wraps to the end of the row');
  assert.equal(nextFocusTarget(grid, c, 'down').name, 'a', 'down on the last row wraps to the top');
  assert.equal(nextFocusTarget(grid, a, 'up').name, 'c', 'up on the first row wraps to the bottom');
});

test('a missing or hidden current element is recovered', () => {
  assert.equal(nextFocusTarget(grid, null, 'right').name, 'a');
  const hidden = { disabled: false, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) };
  assert.equal(nextFocusTarget(grid, hidden, 'right').name, 'a');
  assert.equal(nextFocusTarget([], a, 'right'), null);
});
