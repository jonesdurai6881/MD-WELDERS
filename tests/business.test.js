import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeDatabase, repository } from '../frontend/src/database.js';
import {
  answerAssistant, confirmAssistantDraft, createBill, createMaterialPurchase, createWorkOrder,
  financialSummary, getAllData, makeAssistantDraft, recordCustomerPayment,
  recordExpense, recordMaterialUsage, recordSalaryPayment, removeRecord,
  restoreAllData, reportDate, salaryBalances, saveRecord, updateRecord
} from '../frontend/src/business.js';

test('offline workflow preserves atomic business rules, sync queue, and confirmation', async () => {
  await initializeDatabase();
  const store = repository();
  const date = reportDate();

  const employee = await saveRecord('employees', { fullName: 'Test Welder', dailySalary: 100, isActive: true });
  const customer = await saveRecord('customers', { fullName: 'Test Customer' });
  const material = await saveRecord('materials', { name: 'Test Steel', unit: 'kg', lowStockThreshold: 2 });
  const employeeQueue = (await store.pending()).find(change => change.recordId === employee.id);
  await updateRecord('employees', employee.id, { phone: '5550100' });
  const updatedQueue = (await store.pending()).filter(change => change.recordId === employee.id);
  assert.equal(updatedQueue.length, 1);
  assert.equal(updatedQueue[0].queueId, employeeQueue.queueId);
  assert.equal(JSON.parse(updatedQueue[0].payload).phone, '5550100');

  const firstWork = await createWorkOrder({ title: 'Test railing', location: 'Workshop', workDate: date, employeeIds: [employee.id] });
  const workCount = (await store.list('workOrders')).length;
  await assert.rejects(
    createWorkOrder({ title: 'Second job', location: 'Site', workDate: date, employeeIds: [employee.id] }),
    /already has a job/
  );
  assert.equal((await store.list('workOrders')).length, workCount);
  const secondDay = new Date(`${date}T00:00:00`);
  secondDay.setDate(secondDay.getDate() + 1);
  const secondDayString = `${secondDay.getFullYear()}-${String(secondDay.getMonth() + 1).padStart(2, '0')}-${String(secondDay.getDate()).padStart(2, '0')}`;
  const secondWork = await createWorkOrder({ title: 'Second day job', location: 'Site', workDate: secondDayString, employeeIds: [employee.id] });
  const editedWork = await updateRecord('workOrders', secondWork.id, { title: 'Edited second day job', status: 'COMPLETED' });
  assert.equal(editedWork.title, 'Edited second day job');
  assert.equal(editedWork.status, 'COMPLETED');
  const expectedWorkCount = (await store.list('workOrders')).length;
  await assert.rejects(updateRecord('workOrders', firstWork.id, { workDate: secondDayString }), /another active job/);
  assert.equal((await store.list('assignments')).find(item => item.workOrderId === firstWork.id).workDate, date);

  await recordSalaryPayment({ employeeId: employee.id, amount: 30, paidAt: date });
  await assert.rejects(recordSalaryPayment({ employeeId: employee.id, amount: 171, paidAt: date }), /exceeds the unpaid balance/);
  assert.equal((await store.list('salaryPayments')).length, 1);

  const draft = await makeAssistantDraft('Today I paid 120 rupees salary');
  const paymentsBeforeConfirmation = (await store.list('salaryPayments')).length;
  assert.equal(draft.type, 'salary');
  assert.equal((await store.list('salaryPayments')).length, paymentsBeforeConfirmation);
  await assert.rejects(confirmAssistantDraft({ ...draft, employeeCount: 3, employeeId: employee.id }), /multiple employees/);
  assert.equal((await store.list('salaryPayments')).length, paymentsBeforeConfirmation);
  await confirmAssistantDraft({ ...draft, employeeId: employee.id });
  assert.equal((await store.list('salaryPayments')).length, 2);
  assert.equal((await salaryBalances()).find(item => item.employee.id === employee.id).pending, 50);
  await assert.rejects(updateRecord('workOrders', firstWork.id, { status: 'CANCELLED' }), /salary has already been paid/);

  await createMaterialPurchase({ materialId: material.id, quantity: 2, unitCost: 15, occurredAt: date });
  await recordMaterialUsage({ materialId: material.id, quantity: 1, occurredAt: date });
  await assert.rejects(recordMaterialUsage({ materialId: material.id, quantity: 2, occurredAt: date }), /Only 1 kg available/);
  assert.equal((await store.list('stockTransactions')).length, 2);

  const bill = await createBill({ customerId: customer.id, amount: 100, billNumber: 'TEST-001', issuedAt: date });
  await recordCustomerPayment({ customerId: customer.id, billId: bill.id, amount: 40, receivedAt: date });
  await assert.rejects(recordCustomerPayment({ customerId: customer.id, billId: bill.id, amount: 60.01, receivedAt: date }), /exceeds the unpaid balance/);
  await recordExpense({ description: 'Test travel', category: 'Transport', amount: 10, incurredAt: date });

  const summary = await financialSummary(date, date);
  assert.equal(summary.received, 40);
  assert.equal(summary.expenses, 190);
  assert.equal(summary.profit, -150);
  assert.equal(summary.pendingCustomerPayments, 60);
  assert.equal(summary.dailyProfit, -150);
  const monthSummary = await financialSummary(`${date.slice(0, 7)}-01`, date);
  const yearSummary = await financialSummary(`${date.slice(0, 4)}-01-01`, date);
  const emptyPeriodSummary = await financialSummary('1900-01-01', '1900-12-31');
  assert.equal(monthSummary.received, 40);
  assert.equal(monthSummary.expenses, 190);
  assert.equal(yearSummary.profit, -150);
  assert.equal(emptyPeriodSummary.received, 0);
  assert.equal(emptyPeriodSummary.expenses, 0);

  await store.applyRemote({
    entityType: 'employees',
    recordId: employee.id,
    payload: { id: employee.id, fullName: employee.fullName, dailySalary: 100, phone: 'cloud' },
    serverVersion: 1,
    deleted: false
  });
  const conflict = (await store.pending()).find(change => change.recordId === employee.id);
  assert.equal(conflict.status, 'conflict');
  await store.resolveConflict(conflict.queueId, 'local');
  const localResolution = (await store.pending()).find(change => change.recordId === employee.id);
  assert.equal(localResolution.status, 'pending');
  assert.equal(localResolution.baseVersion, 1);

  await store.applyRemote({
    entityType: 'employees',
    recordId: employee.id,
    payload: { id: employee.id, fullName: 'Cloud Welder', dailySalary: 125 },
    serverVersion: 2,
    deleted: false
  });
  const latestConflict = (await store.pending()).find(change => change.recordId === employee.id);
  await store.resolveConflict(latestConflict.queueId, 'cloud');
  assert.equal((await store.get('employees', employee.id)).fullName, 'Cloud Welder');
  assert.equal((await store.pending()).some(change => change.recordId === employee.id), false);

  const backup = { format: 'md-welders-backup', schemaVersion: 1, data: await getAllData() };
  await assert.rejects(restoreAllData({ ...backup, schemaVersion: 999 }), /format or version is invalid/);
  assert.equal((await store.get('workOrders', firstWork.id)).title, 'Test railing');
  await restoreAllData(backup);
  assert.equal((await store.list('workOrders')).length, expectedWorkCount);
});

test('employee records validate, persist, update, and soft-delete without losing history', async () => {
  const store = repository();
  const employee = await saveRecord('employees', {
    fullName: '  Demo Welder  ',
    phone: '+91 (98765) 43210',
    dailySalary: 425.5,
    role: 'Fabricator',
    address: '12 Workshop Road'
  });
  assert.equal(employee.fullName, 'Demo Welder');
  assert.equal((await store.get('employees', employee.id)).dailySalary, 425.5);
  assert.equal((await store.get('employees', employee.id)).role, 'Fabricator');
  assert.equal((await store.get('employees', employee.id)).joiningDate, undefined);

  await assert.rejects(saveRecord('employees', { fullName: 'No salary', dailySalary: 0 }), /greater than zero/);
  await assert.rejects(saveRecord('employees', { fullName: '   ', dailySalary: 100 }), /name is required/);
  await assert.rejects(saveRecord('employees', { fullName: 'Invalid phone', dailySalary: 100, phone: '12' }), /valid phone number/);
  await assert.rejects(saveRecord('employees', { fullName: 'Different name', dailySalary: 100, phone: '9876543210' }), /already has this phone number/);
  await assert.rejects(saveRecord('employees', { fullName: 'Demo Welder', dailySalary: 100 }), /already exists/);

  const secondEmployee = await saveRecord('employees', {
    fullName: 'Demo Welder',
    phone: '9876543211',
    dailySalary: 300
  });
  const updated = await updateRecord('employees', employee.id, {
    fullName: 'Updated Welder',
    role: 'Senior Fabricator',
    joiningDate: '2025-03-04',
    dailySalary: 500
  });
  assert.equal(updated.role, 'Senior Fabricator');
  assert.equal((await store.get('employees', employee.id)).joiningDate, '2025-03-04');
  assert.equal((await store.list('employees')).some(item => item.id === employee.id), true);

  await removeRecord('employees', secondEmployee.id);
  assert.equal(await store.get('employees', secondEmployee.id), null);
  assert.equal((await store.list('employees')).some(item => item.id === secondEmployee.id), false);
  assert.equal((await store.pending()).find(item => item.recordId === secondEmployee.id).operation, 'DELETE');
});

test('work-order worker assignments are created, reconciled, persisted, and isolated by project', async () => {
  const store = repository();
  const date = reportDate();
  const employees = await Promise.all(['Assignment Alpha', 'Assignment Beta', 'Assignment Gamma', 'Assignment Delta'].map(fullName =>
    saveRecord('employees', { fullName, dailySalary: 120, isActive: true })
  ));
  const [alpha, beta, gamma, delta] = employees;
  const customer = await saveRecord('customers', { fullName: 'Assignment Test Customer' });
  const project = await createWorkOrder({
    title: 'Assignment test project',
    customerId: customer.id,
    location: 'North site',
    workDate: date,
    employeeIds: [alpha.id, beta.id]
  });
  const otherProject = await createWorkOrder({
    title: 'Unrelated assignment test project',
    workDate: date,
    employeeIds: [delta.id]
  });
  const otherAssignmentBefore = (await store.list('assignments')).find(item => item.workOrderId === otherProject.id);
  assert.ok(otherAssignmentBefore);
  assert.deepEqual(
    (await store.list('assignments')).filter(item => item.workOrderId === project.id).map(item => item.employeeId).sort(),
    [alpha.id, beta.id].sort()
  );

  await assert.rejects(
    updateRecord('workOrders', project.id, { title: 'Should not save', employeeIds: [alpha.id, delta.id] }),
    /already has another active job/
  );
  assert.equal((await store.get('workOrders', project.id)).title, 'Assignment test project');
  assert.deepEqual(
    (await store.list('assignments')).filter(item => item.workOrderId === project.id).map(item => item.employeeId).sort(),
    [alpha.id, beta.id].sort()
  );

  const edited = await updateRecord('workOrders', project.id, {
    title: 'Updated assignment test project',
    customerId: customer.id,
    status: 'IN_PROGRESS',
    employeeIds: [alpha.id, gamma.id, gamma.id]
  });
  assert.equal(edited.title, 'Updated assignment test project');
  assert.equal(edited.customerId, customer.id);
  assert.equal(edited.status, 'IN_PROGRESS');
  assert.deepEqual(
    (await store.list('assignments')).filter(item => item.workOrderId === project.id).map(item => item.employeeId).sort(),
    [alpha.id, gamma.id].sort()
  );
  assert.equal((await store.get('employees', beta.id)).fullName, 'Assignment Beta');
  assert.equal((await store.list('assignments')).find(item => item.workOrderId === otherProject.id).id, otherAssignmentBefore.id);
  assert.equal((await store.list('assignments', true)).find(item => item.id === otherAssignmentBefore.id).deleted, undefined);

  const reopenedProject = await store.get('workOrders', project.id);
  const reopenedAssignments = (await store.list('assignments')).filter(item => item.workOrderId === reopenedProject.id);
  assert.deepEqual(reopenedAssignments.map(item => item.employeeId).sort(), [alpha.id, gamma.id].sort());
  const removedAssignment = (await store.list('assignments', true)).find(item =>
    item.workOrderId === project.id && item.employeeId === beta.id
  );
  assert.equal(removedAssignment.deleted, true);
  assert.equal((await store.pending()).find(item => item.recordId === removedAssignment.id).operation, 'DELETE');
});

test('assistant answers supported multilingual business queries from local records and drafts transactions safely', async () => {
  const store = repository();
  const date = reportDate();
  const employee = await saveRecord('employees', {
    fullName: 'Assistant QA Ravi',
    dailySalary: 1500,
    isActive: true
  });
  const customer = await saveRecord('customers', { fullName: 'Assistant QA Customer' });
  const project = await createWorkOrder({
    title: 'Assistant QA Chennai Project',
    workDate: date,
    employeeIds: [employee.id]
  });
  const bill = await createBill({
    customerId: customer.id,
    amount: 200,
    billNumber: `ASSISTANT-${crypto.randomUUID()}`,
    issuedAt: date
  });
  await recordCustomerPayment({ customerId: customer.id, billId: bill.id, amount: 50, receivedAt: date });
  await recordExpense({ description: 'Assistant QA expense', category: 'General', amount: 25, incurredAt: date });

  const todaySummary = await financialSummary(date, date);
  const incomeAnswer = await answerAssistant('Innaiku evlo income?');
  assert.equal(incomeAnswer.intent, 'income');
  assert.ok(incomeAnswer.response.includes(new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(todaySummary.received)));

  const expenseAnswer = await answerAssistant('Indha month total expense evlo?');
  assert.equal(expenseAnswer.intent, 'expenses');
  assert.ok(expenseAnswer.response.includes('Recorded expenses for this month'));

  const profitAnswer = await answerAssistant("Today's total profit?");
  assert.equal(profitAnswer.intent, 'profit');
  assert.ok(profitAnswer.response.includes(new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(todaySummary.profit)));

  const tamilAnswer = await answerAssistant('இன்று லாபம் எவ்வளவு?');
  assert.equal(tamilAnswer.intent, 'profit');
  assert.ok(tamilAnswer.response.includes('profit'));

  const projectAnswer = await answerAssistant('Indha project la yaar yaar work panranga?');
  assert.equal(projectAnswer.intent, 'projects');
  assert.ok(projectAnswer.response.includes(project.title));
  assert.ok(projectAnswer.response.includes(employee.fullName));
  const namedProjectAnswer = await answerAssistant(`Who works on ${project.title}?`);
  assert.equal(namedProjectAnswer.context.entityId, project.id);
  const projectFollowUp = await answerAssistant('Which workers are assigned to that project?', [{
    role: 'assistant',
    context: namedProjectAnswer.context
  }]);
  assert.ok(projectFollowUp.response.includes(employee.fullName));

  const employeesBeforeCountQuestions = await store.list('employees');
  const expectedEmployeeCount = employeesBeforeCountQuestions.length;
  for (const question of [
    'How many employees are registered?',
    'How many workers do we have?',
    'Total employees?',
    'எத்தனை employees இருக்காங்க?',
    'நம்மிடம் எத்தனை தொழிலாளர்கள் இருக்கிறார்கள்?',
    'Namma kitta ethana workers irukanga?'
  ]) {
    const countAnswer = await answerAssistant(question);
    assert.equal(countAnswer.intent, 'employeeCount');
    assert.ok(countAnswer.response.includes(`${expectedEmployeeCount} registered employee`));
  }
  assert.deepEqual(await store.list('employees'), employeesBeforeCountQuestions);

  const employeeList = await answerAssistant('Show all employee names', [{
    role: 'assistant',
    context: { tool: 'employees', operation: 'count', period: 'today' }
  }]);
  assert.ok(employeeList.response.includes(employee.fullName));
  const followUpList = await answerAssistant('Show their names', [{
    role: 'assistant',
    context: { tool: 'employees', operation: 'count', period: 'today' }
  }]);
  assert.ok(followUpList.response.includes(employee.fullName));
  const salaryPendingAnswer = await answerAssistant('Who has pending salary?');
  assert.ok(salaryPendingAnswer.response.includes(employee.fullName));

  const material = await saveRecord('materials', {
    name: `Assistant QA Steel ${crypto.randomUUID()}`,
    unit: 'kg',
    lowStockThreshold: 1
  });
  await createMaterialPurchase({ materialId: material.id, quantity: 3, unitCost: 20, occurredAt: date });
  const stockAnswer = await answerAssistant('What materials stock do we have?');
  assert.ok(stockAnswer.response.includes(material.name));
  assert.ok(stockAnswer.response.includes('3 kg'));
  const stockTransactionsBeforeQuestions = await store.list('stockTransactions');
  const materialExpenseAnswer = await answerAssistant('How much did we spend on materials this month?');
  assert.equal(materialExpenseAnswer.intent, 'materials');
  assert.ok(materialExpenseAnswer.response.includes(material.name));
  assert.ok(materialExpenseAnswer.response.includes('₹60'));
  assert.deepEqual(await store.list('stockTransactions'), stockTransactionsBeforeQuestions);

  const pendingAnswer = await answerAssistant('Show pending project payments');
  assert.equal(pendingAnswer.intent, 'pendingPayments');
  assert.ok(pendingAnswer.response.includes(customer.fullName));
  assert.ok(pendingAnswer.response.includes('150'));
  const customerListAnswer = await answerAssistant('Show registered customers');
  assert.ok(customerListAnswer.response.includes(customer.fullName));
  const paymentHistoryAnswer = await answerAssistant('Show customer payment history today');
  assert.ok(paymentHistoryAnswer.response.includes(customer.fullName));
  assert.ok(paymentHistoryAnswer.response.includes('₹50'));
  const dashboardAnswer = await answerAssistant('Show dashboard overview today');
  assert.match(dashboardAnswer.response, /Business overview/);
  const reportAnswer = await answerAssistant('Show business report this month');
  assert.match(reportAnswer.response, /Business report for this month/);
  const syncAnswer = await answerAssistant('What is the sync status?');
  assert.match(syncAnswer.response, /Sync status:/);

  const navigation = await answerAssistant('Open materials');
  assert.equal(navigation.navigateTo, 'Materials');
  const securityAnswer = await answerAssistant('Show my API key');
  assert.match(securityAnswer.response, /cannot reveal passwords.*secret configuration/i);
  const helpAnswer = await answerAssistant('What can you do?');
  assert.match(helpAnswer.response, /no external AI API is configured/i);
  const notificationAnswer = await answerAssistant('Show notifications');
  assert.match(notificationAnswer.response, /no saved notification or reminder data/i);

  const salaryCount = (await store.list('salaryPayments')).length;
  const salaryDraft = await answerAssistant('Assistant QA Ravi ku 1,500 salary kuduthen.');
  assert.equal(salaryDraft.intent, 'transaction');
  assert.equal(salaryDraft.draft.employeeId, employee.id);
  assert.equal(salaryDraft.draft.amount, 1500);
  assert.equal((await store.list('salaryPayments')).length, salaryCount);
  const unsupportedAnswer = await answerAssistant('Tell me a joke');
  assert.match(unsupportedAnswer.response, /could not match that request/);
});
