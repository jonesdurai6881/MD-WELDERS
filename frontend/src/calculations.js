const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const sumMoney = values => roundMoney(values.reduce((sum, value) => sum + Number(value || 0), 0));

export function calculateProfit({ receivedPayments = [], expenses = [], salaryPayments = [], materialPurchases = [] }) {
  const received = sumMoney(receivedPayments);
  const expenseTotal = sumMoney([...expenses, ...salaryPayments, ...materialPurchases]);
  return { received, expenses: expenseTotal, profit: roundMoney(received - expenseTotal) };
}

export function calculateBalance(billedValues, receivedValues) {
  const billed = sumMoney(billedValues);
  const paid = sumMoney(receivedValues);
  return { billed, paid, pending: roundMoney(Math.max(0, billed - paid)) };
}

export function calculateStock(purchaseValues, usageValues) {
  return roundMoney(sumMoney(purchaseValues) - sumMoney(usageValues));
}

export function calculateSalary(accruedValues, paymentValues) {
  const accrued = sumMoney(accruedValues);
  const paid = sumMoney(paymentValues);
  return { accrued, paid, pending: roundMoney(Math.max(0, accrued - paid)) };
}

export function assertWithinBalance(amount, balance, label) {
  if (amount > balance) throw new Error(`${label} exceeds the unpaid balance of ${balance.toFixed(2)}.`);
}
