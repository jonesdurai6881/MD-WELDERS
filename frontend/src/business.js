import { repository } from './database.js';
import { assertWithinBalance, calculateBalance, calculateProfit, calculateSalary, calculateStock } from './calculations.js';
import { prepareAssistantDraft } from './assistant.js';

const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const makeRecord = values => ({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...values });
const total = (rows, selector) => money(rows.reduce((sum, row) => sum + selector(row), 0));
const amount = value => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Enter an amount greater than zero.');
  return money(parsed);
};
const quantity = value => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Enter a quantity greater than zero.');
  return Math.round((parsed + Number.EPSILON) * 1000) / 1000;
};
const find = async (table, id) => {
  const row = await repository().get(table, id);
  if (!row) throw new Error('The selected record no longer exists.');
  return row;
};
const values = async table => repository().list(table);

function validateRecord(table, record) {
  if (table === 'employees') {
    if (typeof record.fullName !== 'string' || !record.fullName.trim()) throw new Error('Employee name is required.');
    if (!Number.isFinite(Number(record.dailySalary)) || Number(record.dailySalary) <= 0) throw new Error('Daily salary must be greater than zero.');
    if (record.fullName.trim().length > 160) throw new Error('Employee name must be 160 characters or fewer.');
    if (record.role != null && typeof record.role !== 'string') throw new Error('Job role must be text.');
    if (record.role && record.role.trim().length > 80) throw new Error('Job role must be 80 characters or fewer.');
    if (record.phone != null && typeof record.phone !== 'string') throw new Error('Phone number must be text.');
    if (record.phone?.trim()) {
      const digits = record.phone.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) throw new Error('Enter a valid phone number with 7 to 15 digits.');
    }
  } else if (table === 'customers' && !record.fullName?.trim()) {
    throw new Error('Customer name is required.');
  } else if (table === 'materials') {
    if (!record.name?.trim() || !record.unit?.trim()) throw new Error('Material name and unit are required.');
    if (!Number.isFinite(Number(record.lowStockThreshold)) || Number(record.lowStockThreshold) < 0) throw new Error('Low-stock threshold must be a non-negative number.');
  } else if (table === 'workOrders') {
    if (!record.title?.trim() || !record.workDate) throw new Error('Work order name and date are required.');
    if (!['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(record.status)) throw new Error('Choose a valid work order status.');
  } else if (table === 'bills') {
    if (!record.billNumber?.trim() || !record.customerId || !Number.isFinite(Number(record.amount)) || Number(record.amount) <= 0) throw new Error('A valid customer, bill number, and positive total are required.');
  } else if (table === 'assignments') {
    if (!record.employeeId || !record.workOrderId || !record.workDate || !Number.isFinite(Number(record.dailyRate)) || Number(record.dailyRate) < 0) throw new Error('Assignment details and a valid daily rate are required.');
  } else if (table === 'salaryPayments') {
    if (!record.employeeId || !record.paidAt || !Number.isFinite(Number(record.amount)) || Number(record.amount) <= 0) throw new Error('Salary payment details and a positive amount are required.');
  } else if (table === 'stockTransactions') {
    if (!record.materialId || !['PURCHASE', 'USAGE'].includes(record.type) || !record.occurredAt || !Number.isFinite(Number(record.quantity)) || Number(record.quantity) <= 0) throw new Error('Material, transaction type, date, and a positive quantity are required.');
  } else if (table === 'customerPayments') {
    if (!record.customerId || !record.receivedAt || !Number.isFinite(Number(record.amount)) || Number(record.amount) <= 0) throw new Error('Customer payment details and a positive amount are required.');
  } else if (table === 'expenses') {
    if (!record.description?.trim() || !record.incurredAt || !Number.isFinite(Number(record.amount)) || Number(record.amount) <= 0) throw new Error('Expense details, date, and a positive amount are required.');
  }
}

function normalizeEmployee(record) {
  return {
    ...record,
    fullName: record.fullName.trim(),
    phone: record.phone?.trim() || '',
    role: record.role?.trim() || ''
  };
}

function normalizedEmployeePhone(phone = '') {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

async function validateEmployeeUniqueness(record) {
  const employees = await values('employees');
  const normalizedName = record.fullName.trim().replace(/\s+/g, ' ').toLowerCase();
  const normalizedPhone = normalizedEmployeePhone(record.phone);
  for (const employee of employees) {
    if (employee.id === record.id) continue;
    const sameName = employee.fullName?.trim().replace(/\s+/g, ' ').toLowerCase() === normalizedName;
    const employeePhone = normalizedEmployeePhone(employee.phone || '');
    if (normalizedPhone && employeePhone === normalizedPhone) throw new Error('An employee already has this phone number.');
    if (sameName && (!normalizedPhone || !employeePhone)) throw new Error('An employee with this name already exists. Add a different phone number if this is another person.');
  }
}

export async function saveRecord(table, input) {
  if (!input || typeof input !== 'object') throw new Error('Provide valid record details.');
  let record = makeRecord({ ...input, updatedAt: new Date().toISOString() });
  validateRecord(table, record);
  if (table === 'employees') {
    record = normalizeEmployee(record);
    await validateEmployeeUniqueness(record);
  }
  await repository().put(table, record, Number(input.serverVersion || 0));
  return record;
}

export async function updateRecord(table, id, input) {
  const previous = await find(table, id);
  const recordInput = { ...input };
  const requestedEmployeeIds = table === 'workOrders' ? recordInput.employeeIds : undefined;
  if (table === 'workOrders') delete recordInput.employeeIds;
  let record = { ...previous, ...recordInput, id, updatedAt: new Date().toISOString() };
  validateRecord(table, record);
  if (table === 'employees') {
    record = normalizeEmployee(record);
    await validateEmployeeUniqueness(record);
  }
  if (table === 'workOrders') {
    if (requestedEmployeeIds !== undefined && !Array.isArray(requestedEmployeeIds)) {
      throw new Error('Choose a valid worker list.');
    }
    const [allAssignments, payments, orders, employees] = await Promise.all([
      values('assignments'), values('salaryPayments'), values('workOrders'), values('employees')
    ]);
    const orderAssignments = allAssignments.filter(item => item.workOrderId === id);
    const existingByEmployee = new Map();
    for (const assignment of orderAssignments) {
      if (!existingByEmployee.has(assignment.employeeId)) existingByEmployee.set(assignment.employeeId, assignment);
    }
    const selectedIds = [...new Set(requestedEmployeeIds ?? existingByEmployee.keys())];
    const employeeById = new Map(employees.map(employee => [employee.id, employee]));
    for (const employeeId of selectedIds) {
      const employee = employeeById.get(employeeId);
      if (!existingByEmployee.has(employeeId) && (!employee || employee.isActive === false)) {
        throw new Error('A newly assigned active employee could not be found.');
      }
    }

    const nextAssignments = new Map();
    for (const employeeId of selectedIds) {
      const previousAssignment = existingByEmployee.get(employeeId);
      const employee = employeeById.get(employeeId);
      nextAssignments.set(employeeId, previousAssignment
        ? { ...previousAssignment, workDate: record.workDate }
        : makeRecord({
            workOrderId: id,
            employeeId,
            workDate: record.workDate,
            dailyRate: money(employee.dailySalary)
          }));
    }

    const activeOtherOrders = new Set(orders
      .filter(order => order.id !== id && order.status !== 'CANCELLED')
      .map(order => order.id));
    if (record.status !== 'CANCELLED') {
      for (const employeeId of selectedIds) {
        if (allAssignments.some(assignment =>
          assignment.workOrderId !== id &&
          assignment.employeeId === employeeId &&
          assignment.workDate === record.workDate &&
          activeOtherOrders.has(assignment.workOrderId)
        )) {
          const employeeName = employeeById.get(employeeId)?.fullName || 'An employee';
          throw new Error(`${employeeName} already has another active job on ${record.workDate}.`);
        }
      }
    }

    const affectedEmployeeIds = new Set([
      ...existingByEmployee.keys(),
      ...nextAssignments.keys()
    ]);
    for (const employeeId of affectedEmployeeIds) {
      const accruedAfterUpdate = total(allAssignments.filter(assignment => {
        if (assignment.employeeId !== employeeId || assignment.workOrderId === id) return false;
        return orders.some(order => order.id === assignment.workOrderId && order.status !== 'CANCELLED');
      }), assignment => Number(assignment.dailyRate)) +
        (record.status === 'CANCELLED' ? 0 : Number(nextAssignments.get(employeeId)?.dailyRate || 0));
      const paid = total(payments.filter(payment => payment.employeeId === employeeId), payment => Number(payment.amount));
      if (paid > accruedAfterUpdate) {
        throw new Error('This project assignment cannot be changed because salary has already been paid for the removed work.');
      }
    }

    const updates = [{ table, record, baseVersion: Number(previous.serverVersion || 0) }];
    const now = new Date().toISOString();
    const savedEmployeeIds = new Set();
    for (const assignment of orderAssignments) {
      if (!nextAssignments.has(assignment.employeeId) || savedEmployeeIds.has(assignment.employeeId)) {
        updates.push({
          table: 'assignments',
          record: { ...assignment, deleted: true, updatedAt: now },
          baseVersion: Number(assignment.serverVersion || 0)
        });
        continue;
      }
      const next = nextAssignments.get(assignment.employeeId);
      savedEmployeeIds.add(assignment.employeeId);
      if (next.workDate !== assignment.workDate) {
        updates.push({
          table: 'assignments',
          record: { ...next, updatedAt: now },
          baseVersion: Number(assignment.serverVersion || 0)
        });
      }
    }
    for (const [employeeId, assignment] of nextAssignments) {
      if (!savedEmployeeIds.has(employeeId)) updates.push({ table: 'assignments', record: assignment });
    }
    await repository().putMany(updates);
    return record;
  }
  await repository().put(table, record, Number(previous.serverVersion || 0));
  return record;
}

export async function removeRecord(table, id) {
  const previous = await find(table, id);
  if (table === 'workOrders') throw new Error('Work orders with a history are retained. Change the status to Cancelled instead.');
  if (table === 'employees') {
    const balance = (await salaryBalances()).find(item => item.employee.id === id);
    if (balance?.pending > 0) throw new Error('Pay the employee’s outstanding salary before removing the employee record.');
  }
  if (table === 'customers') {
    const [bills, payments, workOrders] = await Promise.all([values('bills'), values('customerPayments'), values('workOrders')]);
    if (bills.some(item => item.customerId === id) || payments.some(item => item.customerId === id) || workOrders.some(item => item.customerId === id)) {
      throw new Error('Customers with bills, payments, or work history are retained to preserve financial records.');
    }
  }
  if (table === 'materials' && (await values('stockTransactions')).some(item => item.materialId === id)) {
    throw new Error('Materials with purchase or usage history are retained to preserve stock records.');
  }
  const deletedAt = new Date().toISOString();
  await repository().put(table, { ...previous, deleted: true, deletedAt, updatedAt: deletedAt }, Number(previous.serverVersion || 0));
}

export async function createWorkOrder(input) {
  if (!input.title?.trim()) throw new Error('A work order name is required.');
  const date = input.workDate || today();
  const [employees, assignments, workOrders] = await Promise.all([values('employees'), values('assignments'), values('workOrders')]);
  const activeOrders = new Set(workOrders.filter(order => order.status !== 'CANCELLED').map(order => order.id));
  if (input.customerId) await find('customers', input.customerId);
  const selectedIds = [...new Set(input.employeeIds || [])];
  for (const employeeId of selectedIds) {
    const employee = employees.find(item => item.id === employeeId);
    if (!employee || employee.isActive === false) throw new Error('An assigned active employee could not be found.');
    if (assignments.some(item => item.employeeId === employeeId && item.workDate === date && activeOrders.has(item.workOrderId))) {
      throw new Error(`${employee.fullName} already has a job on ${date}.`);
    }
  }
  const workOrder = makeRecord({
    title: input.title.trim(),
    customerId: input.customerId || '',
    location: input.location || '',
    workDate: date,
    status: input.status || 'PENDING',
    notes: input.notes || ''
  });
  const entries = [{
    table: 'workOrders',
    record: workOrder
  }];
  for (const employeeId of selectedIds) {
    const employee = employees.find(item => item.id === employeeId);
    entries.push({
      table: 'assignments',
      record: makeRecord({
        workOrderId: workOrder.id,
        employeeId,
        workDate: date,
        dailyRate: money(employee.dailySalary)
      })
    });
  }
  await repository().putMany(entries);
  return workOrder;
}

export async function recordSalaryPayment(input) {
  const employee = await find('employees', input.employeeId);
  const paid = total((await values('salaryPayments')).filter(item => item.employeeId === employee.id), item => Number(item.amount));
  const accrued = await salaryAccrued(employee.id);
  const due = money(accrued - paid);
  const paymentAmount = amount(input.amount);
  assertWithinBalance(paymentAmount, due, 'Payment');
  const payment = makeRecord({
    employeeId: employee.id,
    amount: paymentAmount,
    paidAt: input.paidAt || today(),
    note: input.note || '',
    idempotencyKey: crypto.randomUUID()
  });
  await repository().put('salaryPayments', payment);
  return payment;
}

async function salaryAccrued(employeeId) {
  const assignments = (await values('assignments')).filter(item => item.employeeId === employeeId);
  const workOrders = await values('workOrders');
  const activeOrders = new Set(workOrders.filter(order => order.status !== 'CANCELLED').map(order => order.id));
  return total(assignments.filter(item => activeOrders.has(item.workOrderId)), item => Number(item.dailyRate));
}

export async function salaryBalances() {
  const employees = await values('employees');
  const payments = await values('salaryPayments');
  const assignments = await values('assignments');
  const orders = new Map((await values('workOrders')).map(order => [order.id, order]));
  return employees.map(employee => {
    const balance = calculateSalary(
      assignments.filter(item => item.employeeId === employee.id && orders.get(item.workOrderId)?.status !== 'CANCELLED').map(item => item.dailyRate),
      payments.filter(item => item.employeeId === employee.id).map(item => item.amount));
    return { employee, ...balance };
  });
}

export async function createMaterialPurchase(input) {
  const material = await find('materials', input.materialId);
  const purchaseQuantity = quantity(input.quantity);
  const unitCost = Number(input.unitCost || 0);
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error('Enter a valid material unit cost.');
  const transaction = makeRecord({
    materialId: material.id,
    type: 'PURCHASE',
    quantity: purchaseQuantity,
    unitCost: money(unitCost),
    amount: money(purchaseQuantity * unitCost),
    occurredAt: input.occurredAt || today(),
    idempotencyKey: crypto.randomUUID(),
    note: input.note || ''
  });
  await repository().put('stockTransactions', transaction);
  return transaction;
}

export async function recordMaterialUsage(input) {
  const material = await find('materials', input.materialId);
  const usageQuantity = quantity(input.quantity);
  const transactions = (await values('stockTransactions')).filter(item => item.materialId === material.id);
  const available = calculateStock(
    transactions.filter(item => item.type === 'PURCHASE').map(item => item.quantity),
    transactions.filter(item => item.type === 'USAGE').map(item => item.quantity));
  if (usageQuantity > available) throw new Error(`Only ${available} ${material.unit} available in stock.`);
  const transaction = makeRecord({
    materialId: material.id,
    type: 'USAGE',
    quantity: usageQuantity,
    workOrderId: input.workOrderId || '',
    occurredAt: input.occurredAt || today(),
    idempotencyKey: crypto.randomUUID(),
    note: input.note || ''
  });
  await repository().put('stockTransactions', transaction);
  return transaction;
}

export async function stockBalances() {
  const materials = await values('materials');
  const transactions = await values('stockTransactions');
  return materials.map(material => {
    const rows = transactions.filter(item => item.materialId === material.id);
    return {
      material,
      available: calculateStock(
        rows.filter(item => item.type === 'PURCHASE').map(item => item.quantity),
        rows.filter(item => item.type === 'USAGE').map(item => item.quantity)),
      purchaseExpense: total(rows.filter(item => item.type === 'PURCHASE'), item => Number(item.amount || 0))
    };
  });
}

export async function createBill(input) {
  const customer = await find('customers', input.customerId);
  const billAmount = amount(input.amount);
  const existing = await values('bills');
  const billNumber = input.billNumber?.trim() || `MD-${new Date().getFullYear()}-${String(existing.length + 1).padStart(4, '0')}`;
  if (existing.some(bill => bill.billNumber === billNumber)) throw new Error('That bill number is already in use.');
  const bill = makeRecord({
    customerId: customer.id,
    workOrderId: input.workOrderId || '',
    billNumber,
    amount: billAmount,
    issuedAt: input.issuedAt || today(),
    description: input.description || ''
  });
  await repository().put('bills', bill);
  return bill;
}

export async function recordCustomerPayment(input) {
  const customer = await find('customers', input.customerId);
  const paymentAmount = amount(input.amount);
  let bill;
  if (input.billId) {
    bill = await find('bills', input.billId);
    if (bill.customerId !== customer.id) throw new Error('The bill does not belong to this customer.');
    const paid = total((await values('customerPayments')).filter(payment => payment.billId === bill.id), payment => Number(payment.amount));
    assertWithinBalance(paymentAmount, money(Number(bill.amount) - paid), 'Payment');
  }
  const payment = makeRecord({
    customerId: customer.id,
    billId: bill?.id || '',
    amount: paymentAmount,
    receivedAt: input.receivedAt || today(),
    method: input.method || 'Cash',
    note: input.note || '',
    idempotencyKey: crypto.randomUUID()
  });
  await repository().put('customerPayments', payment);
  return payment;
}

export async function recordExpense(input) {
  if (!input.description?.trim()) throw new Error('Enter an expense description.');
  const expense = makeRecord({
    category: input.category || 'General',
    description: input.description.trim(),
    amount: amount(input.amount),
    incurredAt: input.incurredAt || today(),
    idempotencyKey: crypto.randomUUID()
  });
  await repository().put('expenses', expense);
  return expense;
}

export async function customerBalances() {
  const customers = await values('customers');
  const bills = await values('bills');
  const payments = await values('customerPayments');
  return customers.map(customer => {
    const customerBills = bills.filter(bill => bill.customerId === customer.id);
    const balance = calculateBalance(
      customerBills.map(bill => bill.amount),
      payments.filter(payment => payment.customerId === customer.id).map(payment => payment.amount));
    return { customer, ...balance };
  });
}

export async function financialSummary(start, end) {
  const within = date => date >= start && date <= end;
  const [payments, expenses, salary, stock] = await Promise.all([
    values('customerPayments'), values('expenses'), values('salaryPayments'), values('stockTransactions')
  ]);
  const directExpenses = total(expenses.filter(item => within(item.incurredAt)), item => Number(item.amount));
  const salaryExpenses = total(salary.filter(item => within(item.paidAt)), item => Number(item.amount));
  const purchaseExpenses = total(stock.filter(item => item.type === 'PURCHASE' && within(item.occurredAt)), item => Number(item.amount || 0));
  const result = calculateProfit({
    receivedPayments: payments.filter(item => within(item.receivedAt)).map(item => item.amount),
    expenses: expenses.filter(item => within(item.incurredAt)).map(item => item.amount),
    salaryPayments: salary.filter(item => within(item.paidAt)).map(item => item.amount),
    materialPurchases: stock.filter(item => item.type === 'PURCHASE' && within(item.occurredAt)).map(item => item.amount || 0)
  });
  const expenseTotal = money(directExpenses + salaryExpenses + purchaseExpenses);
  const bills = await values('bills');
  const billPayments = await values('customerPayments');
  const pending = total(bills, bill => Math.max(0, Number(bill.amount) - total(billPayments.filter(item => item.billId === bill.id), item => Number(item.amount))));
  return {
    ...result,
    expenses: expenseTotal,
    pendingCustomerPayments: pending,
    dailyProfit: await periodProfit(today(), today()),
    incomeRows: payments.filter(item => within(item.receivedAt)),
    expenseRows: [
      ...expenses.filter(item => within(item.incurredAt)).map(item => ({ ...item, source: 'Expense' })),
      ...salary.filter(item => within(item.paidAt)).map(item => ({ ...item, description: 'Salary payment', incurredAt: item.paidAt, source: 'Salary' })),
      ...stock.filter(item => item.type === 'PURCHASE' && within(item.occurredAt)).map(item => ({ ...item, description: `Material purchase`, incurredAt: item.occurredAt, source: 'Stock purchase' }))
    ]
  };
}

async function periodProfit(start, end) {
  const [payments, expenses, salary, stock] = await Promise.all([
    values('customerPayments'), values('expenses'), values('salaryPayments'), values('stockTransactions')
  ]);
  const within = date => date >= start && date <= end;
  return calculateProfit({
    receivedPayments: payments.filter(item => within(item.receivedAt)).map(item => item.amount),
    expenses: expenses.filter(item => within(item.incurredAt)).map(item => item.amount),
    salaryPayments: salary.filter(item => within(item.paidAt)).map(item => item.amount),
    materialPurchases: stock.filter(item => item.type === 'PURCHASE' && within(item.occurredAt)).map(item => item.amount || 0)
  }).profit;
}

export async function makeAssistantDraft(text) {
  const draft = prepareAssistantDraft(text, today());
  if (draft.type === 'salary') {
    const employees = await values('employees');
    const normalized = text.toLocaleLowerCase();
    const matches = employees.filter(employee => {
      const name = employee.fullName.trim().toLocaleLowerCase();
      return name.length >= 2 && normalized.includes(name);
    });
    if (matches.length === 1) draft.employeeId = matches[0].id;
  }
  if (draft.type === 'income') {
    const customers = await values('customers');
    const normalized = text.toLocaleLowerCase();
    const matches = customers.filter(customer => {
      const name = customer.fullName.trim().toLocaleLowerCase();
      return name.length >= 2 && normalized.includes(name);
    });
    if (matches.length === 1) draft.customerId = matches[0].id;
  }
  return draft;
}

export async function answerAssistant(text, conversation = []) {
  const service = await import('./assistant-service.js');
  return service.answerAssistant(text, conversation);
}

export async function confirmAssistantDraft(draft) {
  if (!draft || !Number.isFinite(Number(draft.amount)) || Number(draft.amount) <= 0) throw new Error('Review the transaction amount before confirming.');
  if (draft.type === 'expense') return recordExpense({ description: draft.description, category: draft.category, amount: draft.amount, incurredAt: draft.date });
  if (draft.type === 'salary') {
    if (Number(draft.employeeCount || 1) !== 1) throw new Error('This statement mentions multiple employees. Record each person’s salary separately to avoid guessing how the amount should be split.');
    if (!draft.employeeId) throw new Error('Choose an employee before recording salary.');
    return recordSalaryPayment({ employeeId: draft.employeeId, amount: draft.amount, paidAt: draft.date, note: draft.description });
  }
  if (!draft.customerId) throw new Error('Choose a customer before recording received income.');
  return recordCustomerPayment({ customerId: draft.customerId, amount: draft.amount, receivedAt: draft.date, note: draft.description });
}

export async function getAllData() {
  const result = {};
  for (const table of ['employees', 'customers', 'workOrders', 'assignments', 'salaryPayments', 'materials', 'stockTransactions', 'bills', 'customerPayments', 'expenses', 'aiProposals', 'settings']) {
    result[table] = await repository().list(table, true);
  }
  return result;
}

export async function restoreAllData(data) {
  const expected = ['employees', 'customers', 'workOrders', 'assignments', 'salaryPayments', 'materials', 'stockTransactions', 'bills', 'customerPayments', 'expenses', 'aiProposals', 'settings'];
  if (!data || data.format !== 'md-welders-backup' || data.schemaVersion !== 1 || !data.data || expected.some(table => !Array.isArray(data.data[table]))) {
    throw new Error('Backup format or version is invalid. No local data was changed.');
  }
  const ids = new Map();
  for (const table of expected) {
    for (const row of data.data[table]) {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id || ids.get(table)?.has(row.id)) throw new Error('Backup contains an invalid or duplicate record ID.');
      if (!ids.has(table)) ids.set(table, new Set());
      ids.get(table).add(row.id);
      validateRecord(table, row);
    }
  }
  const exists = (table, id) => !id || ids.get(table).has(id);
  const validReferences = [
    ...data.data.workOrders.map(row => exists('customers', row.customerId)),
    ...data.data.assignments.map(row => exists('employees', row.employeeId) && exists('workOrders', row.workOrderId)),
    ...data.data.salaryPayments.map(row => exists('employees', row.employeeId)),
    ...data.data.stockTransactions.map(row => exists('materials', row.materialId) && exists('workOrders', row.workOrderId)),
    ...data.data.bills.map(row => exists('customers', row.customerId) && exists('workOrders', row.workOrderId)),
    ...data.data.customerPayments.map(row => exists('customers', row.customerId) && exists('bills', row.billId))
  ];
  if (validReferences.includes(false)) throw new Error('Backup has broken customer, employee, material, bill, or work-order references. No local data was changed.');
  const assignedDays = new Set();
  for (const assignment of data.data.assignments) {
    const key = `${assignment.employeeId}:${assignment.workDate}`;
    if (assignedDays.has(key)) throw new Error('Backup assigns an employee to multiple jobs on the same day. No local data was changed.');
    assignedDays.add(key);
  }
  const billNumbers = new Set();
  for (const bill of data.data.bills) {
    if (billNumbers.has(bill.billNumber)) throw new Error('Backup contains duplicate bill numbers. No local data was changed.');
    billNumbers.add(bill.billNumber);
  }
  const transactionKeys = new Set();
  for (const table of ['salaryPayments', 'stockTransactions', 'customerPayments', 'expenses']) {
    for (const transaction of data.data[table]) {
      if (!transaction.idempotencyKey || transactionKeys.has(transaction.idempotencyKey)) {
        throw new Error('Backup contains missing or duplicate transaction idempotency keys. No local data was changed.');
      }
      transactionKeys.add(transaction.idempotencyKey);
    }
  }
  const activeOrders = new Set(data.data.workOrders.filter(order => order.status !== 'CANCELLED').map(order => order.id));
  const salaryDueByEmployee = new Map();
  for (const assignment of data.data.assignments) {
    if (activeOrders.has(assignment.workOrderId)) salaryDueByEmployee.set(assignment.employeeId, (salaryDueByEmployee.get(assignment.employeeId) || 0) + Number(assignment.dailyRate));
  }
  for (const payment of data.data.salaryPayments) {
    const remaining = salaryDueByEmployee.get(payment.employeeId) || 0;
    if (Number(payment.amount) > remaining) throw new Error('Backup contains salary payments above assigned salary. No local data was changed.');
    salaryDueByEmployee.set(payment.employeeId, remaining - Number(payment.amount));
  }
  for (const bill of data.data.bills) {
    const paid = total(data.data.customerPayments.filter(payment => payment.billId === bill.id), payment => Number(payment.amount));
    if (paid > Number(bill.amount)) throw new Error(`Backup payments exceed bill ${bill.billNumber}. No local data was changed.`);
  }
  for (const material of data.data.materials) {
    const movements = data.data.stockTransactions.filter(item => item.materialId === material.id);
    if (calculateStock(
      movements.filter(item => item.type === 'PURCHASE').map(item => item.quantity),
      movements.filter(item => item.type === 'USAGE').map(item => item.quantity)) < 0) {
      throw new Error(`Backup has negative stock for ${material.name}. No local data was changed.`);
    }
  }
  await repository().replaceAll(data.data);
}

export async function dashboardData() {
  const [employees, workOrders, balances, stock, summary] = await Promise.all([
    values('employees'), values('workOrders'), salaryBalances(), stockBalances(), financialSummary('0000-01-01', '9999-12-31')
  ]);
  const todayJobs = workOrders.filter(order => order.workDate === today() && order.status !== 'CANCELLED');
  return {
    employeeCount: employees.length,
    activeJobs: workOrders.filter(order => ['PENDING', 'IN_PROGRESS'].includes(order.status)).length,
    todayJobs: todayJobs.length,
    received: summary.received,
    profit: summary.profit,
    pendingSalary: total(balances, item => item.pending),
    lowStock: stock.filter(item => item.available <= Number(item.material.lowStockThreshold)).length
  };
}

export const reportDate = today;
