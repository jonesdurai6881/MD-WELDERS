import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertWithinBalance, calculateBalance, calculateProfit, calculateSalary, calculateStock
} from '../frontend/src/calculations.js';

test('profit counts received payments and actual expenses only', () => {
  const result = calculateProfit({
    receivedPayments: [1000, 250],
    expenses: [100],
    salaryPayments: [300],
    materialPurchases: [150]
  });
  assert.deepEqual(result, { received: 1250, expenses: 550, profit: 700 });
});

test('unpaid bills do not become income', () => {
  assert.deepEqual(calculateBalance([1000], [300]), { billed: 1000, paid: 300, pending: 700 });
  assert.deepEqual(calculateProfit({ receivedPayments: [300] }), { received: 300, expenses: 0, profit: 300 });
});

test('profit rounds consistently to cents', () => {
  assert.deepEqual(calculateProfit({ receivedPayments: [0.1, 0.2], expenses: [0.1] }), {
    received: 0.3, expenses: 0.1, profit: 0.2
  });
});

test('salary balance includes partial payments and never reports negative debt', () => {
  assert.deepEqual(calculateSalary([500, 300], [200]), { accrued: 800, paid: 200, pending: 600 });
  assert.deepEqual(calculateSalary([100], [150]), { accrued: 100, paid: 150, pending: 0 });
});

test('overpayments are rejected', () => {
  assert.throws(() => assertWithinBalance(101, 100, 'Payment'), /exceeds the unpaid balance/);
  assert.doesNotThrow(() => assertWithinBalance(100, 100, 'Payment'));
});

test('stock decreases by used quantities', () => {
  assert.equal(calculateStock([10, 4], [3, 2]), 9);
  assert.equal(calculateStock([0.75], [0.25]), 0.5);
});
