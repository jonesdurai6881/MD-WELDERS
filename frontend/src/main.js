import Chart from 'chart.js/auto';
import { Capacitor } from '@capacitor/core';
import './styles.css';
import { initializeDatabase, repository } from './database.js';
import {
  answerAssistant, confirmAssistantDraft, createBill, createMaterialPurchase, createWorkOrder, customerBalances,
  dashboardData, financialSummary, getAllData, recordCustomerPayment,
  recordExpense, recordMaterialUsage, recordSalaryPayment, removeRecord, reportDate,
  restoreAllData, salaryBalances, saveRecord, stockBalances, updateRecord
} from './business.js';
import {
  connectSync, logoutSync, registeredDevices, remoteSyncStatus, revokeDevice, startAutomaticSync, syncNow, syncStatus
} from './sync.js';
import { isVoiceInputActive, startVoiceInput as startVoiceRecognition, stopVoiceInput } from './voice.js';

const icon = {
  Dashboard: '◫', Employees: '♙', Work: '⚒', Salary: '◉', Materials: '▦',
  Customers: '♧', Income: '↗', 'Income detector': '◔', Assistant: '✳',
  Reports: '▤', Backup: '◩', Settings: '⚙'
};
const routes = ['Dashboard', 'Employees', 'Work', 'Salary', 'Materials', 'Customers', 'Income', 'Income detector', 'Assistant', 'Reports', 'Backup', 'Settings'];
const employeeFormAction = 'form-employees';
const state = {
  page: 'Dashboard', search: '', draft: null, chat: [], assistantThinking: false,
  chart: null, toastTimer: null, searchTimer: null, period: 'month',
  voiceEnabled: localStorage.getItem('mdwelders.voiceEnabled') === 'true',
  voiceLanguage: localStorage.getItem('mdwelders.voiceLanguage') || 'en-IN',
  voiceTarget: null, voiceActive: false
};
const app = document.querySelector('#app');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const currency = value => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = reportDate;
const dateMonthStart = () => `${today().slice(0, 7)}-01`;
function selectedDateRange() {
  const end = today();
  if (state.period === 'today') return { start: end, end };
  if (state.period === 'year') return { start: `${end.slice(0, 4)}-01-01`, end };
  if (state.period === 'custom') return { start: state.dateStart || dateMonthStart(), end: state.dateEnd || end };
  return { start: dateMonthStart(), end };
}
function periodButtons() {
  return `<div style="display:flex;gap:6px;flex-wrap:wrap">${[['today','Today'],['month','This month'],['year','This year'],['custom','Custom']].map(([value,label])=>`<button class="button button-small ${state.period===value?'button-primary':'button-secondary'}" data-action="period" data-period="${value}">${label}</button>`).join('')}</div>`;
}
const sectionTitles = {
  Dashboard: 'Your workshop, at a glance',
  Employees: 'Your people are your greatest strength',
  Work: 'Keep every team on the same page',
  Salary: 'Fair, accurate payroll',
  Materials: 'Stock and purchases, under control',
  Customers: 'Build lasting customer relationships',
  Income: 'Every payment, accounted for',
  'Income detector': 'Know what your business really earns',
  Assistant: 'Say it, review it, then record it',
  Reports: 'Clear numbers. Better decisions.',
  Backup: 'Your business data stays yours',
  Settings: 'Make MD Welders work your way'
};

function shell() {
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><div class="brand-mark">MD</div><div><strong>MD WELDERS</strong><small>Workshop management</small></div></div>
        <div><div class="nav-label">WORKSPACE</div><nav class="nav-list" aria-label="Main navigation">
          ${routes.map(route => `<button class="nav-button ${state.page === route ? 'active' : ''}" data-page="${escapeHtml(route)}"><span class="nav-icon">${icon[route]}</span>${escapeHtml(route)}</button>`).join('')}
        </nav></div>
        <div class="sidebar-foot"><div class="connectivity"><span class="dot"></span><span id="sideSync">Your data stays on this device</span></div><div>Offline-first &middot; Local data storage</div></div>
      </aside>
      <main class="main-area">
        <header class="topbar"><div style="display:flex;align-items:center;gap:12px"><button class="mobile-menu" data-action="menu" aria-label="Open navigation">☰</button><span class="crumb">Workspace <span style="color:#b4bfca">/</span> <strong id="crumb">${escapeHtml(state.page)}</strong></span></div>
          <div class="top-actions"><button class="sync-pill" data-action="sync"><span class="dot"></span><span id="syncLabel">Checking local changes...</span></button><div class="avatar" title="Workshop administrator">MD</div></div>
        </header>
        <section class="content" id="content"></section>
      </main>
    </div><div id="overlay"></div><div id="toastHost"></div>`;
  updateSyncLabel();
  renderPage();
}

function heading(kicker, title, action = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${escapeHtml(kicker)}</div><h1>${escapeHtml(title)}</h1><p class="subtitle">${escapeHtml(sectionTitles[state.page])}</p></div>${action}</div>`;
}
function button(text, action, primary = false, extra = '') {
  return `<button class="button ${primary ? 'button-primary' : 'button-secondary'}" data-action="${escapeHtml(action)}" ${extra}>${text}</button>`;
}
function cardMetric(label, value, note, symbol, good = false) {
  return `<article class="card metric"><div class="metric-top">${escapeHtml(label)}<span class="metric-icon">${symbol}</span></div><div class="metric-value">${escapeHtml(value)}</div><div class="metric-note ${good ? 'good' : ''}">${escapeHtml(note)}</div></article>`;
}
function panel(title, body, extra = '') {
  return `<section class="panel"><div class="panel-heading"><h2>${escapeHtml(title)}</h2>${extra}</div>${body}</section>`;
}
function table(headers, rows, empty = 'Nothing here yet. Add your first record to get started.') {
  if (!rows.length) return `<div class="empty">${escapeHtml(empty)}</div>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map(item => `<th>${escapeHtml(item)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
function badge(status) {
  const value = String(status || 'Pending').toLowerCase();
  const style = value.includes('completed') || value === 'paid' || value === 'in stock' ? 'good' : value.includes('conflict') || value === 'failed' ? 'conflict' : 'pending';
  return `<span class="badge ${style}">${escapeHtml(String(status).replaceAll('_', ' '))}</span>`;
}
function actions(tableName, id, canDelete = true) {
  return `<button class="button button-secondary button-small" data-action="edit" data-table="${escapeHtml(tableName)}" data-id="${escapeHtml(id)}">Edit</button>${canDelete ? ` <button class="button button-danger button-small" data-action="delete" data-table="${escapeHtml(tableName)}" data-id="${escapeHtml(id)}">Delete</button>` : ''}`;
}
async function renderPage() {
  state.search = document.querySelector('#searchInput')?.value || state.search;
  document.querySelector('#crumb').textContent = state.page;
  const content = document.querySelector('#content');
  if (!content) return;
  content.innerHTML = '<div class="panel empty">Loading your saved records...</div>';
  try {
    const renderers = {
      Dashboard: renderDashboard, Employees: renderEmployees, Work: renderWork,
      Salary: renderSalary, Materials: renderMaterials, Customers: renderCustomers,
      Income: renderIncome, 'Income detector': renderDetector, Assistant: renderAssistant,
      Reports: renderReports, Backup: renderBackup, Settings: renderSettings
    };
    content.innerHTML = await renderers[state.page]();
    decorateVoiceInputs(content);
    await updateSyncLabel();
    if (state.page === 'Dashboard' || state.page === 'Reports' || state.page === 'Income detector') drawChart();
  } catch (error) {
    content.innerHTML = `<section class="panel"><h2>Could not load this section</h2><p class="subtitle">${escapeHtml(error.message)}</p>${button('Try again', 'refresh')}</section>`;
  }
}

async function renderDashboard() {
  const [data, jobs, stock, summary, queue] = await Promise.all([
    dashboardData(), repository().list('workOrders'), stockBalances(), financialSummary(dateMonthStart(), today()), syncStatus()
  ]);
  const recent = jobs.filter(item => item.status !== 'CANCELLED').sort((a, b) => b.workDate.localeCompare(a.workDate)).slice(0, 5);
  const alerts = [
    ...(data.lowStock ? [`${data.lowStock} material${data.lowStock > 1 ? 's' : ''} at or below minimum stock`] : []),
    ...(queue.conflicts ? [`${queue.conflicts} cloud change${queue.conflicts > 1 ? 's' : ''} need review`] : []),
    ...(data.pendingSalary ? [`${currency(data.pendingSalary)} salary balance remains`] : [])
  ];
  return `${heading('TODAY AT THE WORKSHOP', 'Good work starts with a clear picture', button('＋ New work order', 'form-work', true))}
    <div class="cards">
      ${cardMetric('Income received this month', currency(summary.received), 'Customer payments actually received', '↗', true)}
      ${cardMetric('Business profit this month', currency(summary.profit), 'Received income minus paid expenses', '◔', summary.profit >= 0)}
      ${cardMetric('Active work orders', String(data.activeJobs), `${data.todayJobs} scheduled for today`, '⚒')}
      ${cardMetric('Team & stock', `${data.employeeCount} · ${stock.length}`, `${data.lowStock} low-stock alerts`, '♙')}
    </div>
    <div class="dashboard-grid">
      ${panel('Income & expenses', '<div class="chart-wrap"><canvas id="businessChart" aria-label="Monthly income and expense comparison"></canvas></div>', '<span class="badge">Last 6 months</span>')}
      ${panel('Quick actions', `<div class="quick-grid">
        ${[['♙','Add employee',employeeFormAction],['＋','Record payment','form-customer-payment'],['▦','Add material','form-material'],['₹','Record expense','form-expense'],['⚒','New work order','form-work'],['✳','Ask assistant','page-Assistant']].map(([symbol,label,action]) => `<button class="quick-action" data-action="${action}"><span class="quick-icon">${symbol}</span>${label}</button>`).join('')}
      </div>`)}
      ${panel('Latest work orders', table(['Job','Location','Work date','Status'], recent.map(order => `<tr><td>${escapeHtml(order.title)}</td><td>${escapeHtml(order.location || '—')}</td><td>${escapeHtml(order.workDate)}</td><td>${badge(order.status)}</td></tr>`), 'No work orders yet. Create one to assign your team.'))}
      ${panel('Needs your attention', alerts.length ? `<div class="alert-list">${alerts.map(message => `<div class="alert-item"><span class="alert-symbol">◈</span><div><strong>Check your records</strong><span>${escapeHtml(message)}</span></div></div>`).join('')}</div>` : '<div class="empty">All caught up. Your workshop is in good shape.</div>')}
    </div>`;
}

async function renderEmployees() {
  const employees = await repository().list('employees');
  const rows = employees.filter(employee => `${employee.fullName} ${employee.phone} ${employee.location} ${employee.role}`.toLowerCase().includes(state.search.toLowerCase()))
    .map(employee => `<tr><td>${escapeHtml(employee.fullName)}</td><td>${escapeHtml(employee.role || '—')}</td><td>${escapeHtml(employee.phone || '—')}</td><td>${escapeHtml(employee.location || '—')}</td><td>${escapeHtml(employee.joiningDate || '—')}</td><td>${currency(employee.dailySalary)}</td><td>${badge(employee.isActive === false ? 'Inactive' : 'Active')}</td><td><button class="button button-secondary button-small" data-action="employee-detail" data-id="${escapeHtml(employee.id)}">Details</button> ${actions('employees', employee.id)}</td></tr>`);
  return `${heading('YOUR TEAM', 'Employee management', button('＋ Add employee', employeeFormAction, true))}
    <section class="panel"><div class="toolbar"><input id="searchInput" class="input search" placeholder="Search name, role, phone or location" value="${escapeHtml(state.search)}"><select class="select" id="employeeFilter"><option value="all">All employees</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
      ${table(['Employee','Job role','Phone','Location','Joined','Daily salary','Status','Actions'], rows, 'No employees found. Add your first team member.')}
    </section>`;
}

async function renderWork() {
  const [orders, assignments, employees, customers] = await Promise.all([
    repository().list('workOrders'), repository().list('assignments'), repository().list('employees'), repository().list('customers')
  ]);
  const matches = orders.filter(order => `${order.title} ${order.location}`.toLowerCase().includes(state.search.toLowerCase())).sort((a, b) => b.workDate.localeCompare(a.workDate));
  const rows = matches.map(order => {
    const assigned = assignments.filter(item => item.workOrderId === order.id).map(item => employees.find(employee => employee.id === item.employeeId)?.fullName || 'Former employee').join(', ');
    const customer = customers.find(item => item.id === order.customerId)?.fullName || '—';
    const teamCost = assignments.filter(item => item.workOrderId === order.id).reduce((sum, item) => sum + Number(item.dailyRate), 0);
    return `<tr><td>${escapeHtml(order.title)}</td><td>${escapeHtml(customer)}</td><td>${escapeHtml(order.location || '—')}</td><td>${escapeHtml(order.workDate)}</td><td>${escapeHtml(assigned || 'Unassigned')}</td><td>${currency(teamCost)}</td><td>${badge(order.status)}</td><td><button class="button button-secondary button-small" data-action="work-detail" data-id="${escapeHtml(order.id)}">View</button> ${actions('workOrders', order.id, false)}</td></tr>`;
  });
  return `${heading('JOBS & CREWS', 'Work & team management', button('＋ Create work order', 'form-work', true))}
    <section class="panel"><div class="toolbar"><input class="input search" id="searchInput" placeholder="Search jobs or locations" value="${escapeHtml(state.search)}"></div>
      ${table(['Work order','Customer','Location','Date','Team','Team salary','Status','Actions'], rows, 'No jobs yet. Create a work order and assign a team.')}
      <div class="notice">Each employee can be assigned to only one job per day. Daily team salary is calculated from the assigned employees’ daily rates.</div>
    </section>`;
}

async function renderSalary() {
  const [balances, payments] = await Promise.all([salaryBalances(), repository().list('salaryPayments')]);
  const employees = balances.filter(row => `${row.employee.fullName} ${row.employee.phone}`.toLowerCase().includes(state.search.toLowerCase()));
  const paymentRows = payments.sort((a,b)=>b.paidAt.localeCompare(a.paidAt)).slice(0,12).map(payment=>`<tr><td>${escapeHtml(balances.find(item=>item.employee.id===payment.employeeId)?.employee.fullName||'Former employee')}</td><td>${escapeHtml(payment.paidAt)}</td><td>${currency(payment.amount)}</td><td>${escapeHtml(payment.note||'—')}</td></tr>`);
  return `${heading('PAYROLL', 'Salary management', button('＋ Record payment', 'form-salary-payment', true))}
    <section class="panel"><div class="toolbar"><input class="input search" id="searchInput" placeholder="Search employee" value="${escapeHtml(state.search)}"></div>
      ${table(['Employee','Daily rate','Salary accrued','Paid to date','Balance due','Action'], employees.map(item => `<tr><td>${escapeHtml(item.employee.fullName)}</td><td>${currency(item.employee.dailySalary)}</td><td>${currency(item.accrued)}</td><td>${currency(item.paid)}</td><td>${currency(item.pending)}</td><td><button class="button button-secondary button-small" data-action="pay-employee" data-id="${escapeHtml(item.employee.id)}" ${item.pending <= 0 ? 'disabled' : ''}>Pay salary</button></td></tr>`), 'No employees to show. Add an employee and assign them to a work order.')}
    </section><div style="height:16px"></div>${panel('Recent salary payments',table(['Employee','Paid on','Amount','Note'],paymentRows,'No salary payments recorded yet.'))}
    <div class="notice">Salary is accrued from non-cancelled work assignments. Payments are capped at each employee’s outstanding balance.</div>`;
}

async function renderMaterials() {
  const [balances, transactions] = await Promise.all([stockBalances(), repository().list('stockTransactions')]);
  const rows = balances.filter(item => `${item.material.name} ${item.material.unit}`.toLowerCase().includes(state.search.toLowerCase())).map(item => `<tr><td>${escapeHtml(item.material.name)}</td><td>${escapeHtml(item.material.unit)}</td><td>${item.available} ${escapeHtml(item.material.unit)}</td><td>${Number(item.material.lowStockThreshold || 0)}</td><td>${currency(item.purchaseExpense)}</td><td>${badge(item.available <= Number(item.material.lowStockThreshold) ? 'Low stock' : 'In stock')}</td><td>${actions('materials', item.material.id)}</td></tr>`);
  return `${heading('INVENTORY', 'Materials & stock', `<div style="display:flex;gap:8px">${button('＋ Purchase', 'form-purchase')}${button('− Record usage', 'form-usage', true)}</div>`)}
    <section class="panel"><div class="toolbar"><input class="input search" id="searchInput" placeholder="Search materials" value="${escapeHtml(state.search)}">${button('＋ Add material','form-material')}</div>
      ${table(['Material','Unit','Available','Low stock at','Purchase expenses','Status','Actions'],rows,'No materials in your inventory. Add materials before recording purchases.')}
    </section>
    ${panel('Recent stock movements', table(['Material','Type','Quantity','Date','Cost'], transactions.sort((a,b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0,8).map(item => `<tr><td>${escapeHtml(balances.find(row => row.material.id === item.materialId)?.material.name || 'Material')}</td><td>${badge(item.type)}</td><td>${item.quantity}</td><td>${escapeHtml(item.occurredAt)}</td><td>${item.type === 'PURCHASE' ? currency(item.amount) : '—'}</td></tr>`),'No stock movements recorded yet.'))}`;
}

async function renderCustomers() {
  const balances = await customerBalances();
  const rows = balances.filter(item => `${item.customer.fullName} ${item.customer.phone} ${item.customer.location}`.toLowerCase().includes(state.search.toLowerCase()))
    .map(item => `<tr><td>${escapeHtml(item.customer.fullName)}</td><td>${escapeHtml(item.customer.phone || '—')}</td><td>${escapeHtml(item.customer.location || '—')}</td><td>${currency(item.billed)}</td><td>${currency(item.paid)}</td><td>${currency(item.pending)}</td><td><button class="button button-secondary button-small" data-action="customer-detail" data-id="${escapeHtml(item.customer.id)}">History</button> ${actions('customers', item.customer.id)}</td></tr>`);
  return `${heading('YOUR CUSTOMERS', 'Customer management', button('＋ Add customer', 'form-customer', true))}
    <section class="panel"><div class="toolbar"><input class="input search" id="searchInput" placeholder="Search customer or phone" value="${escapeHtml(state.search)}"></div>
    ${table(['Customer','Phone','Location','Billed','Paid','Outstanding','Actions'],rows,'No customers yet. Add a customer to get started.')}</section>`;
}

async function renderIncome() {
  const [payments, bills, expenses, customers] = await Promise.all([
    repository().list('customerPayments'), repository().list('bills'), repository().list('expenses'), repository().list('customers')
  ]);
  const customerName = id => customers.find(item => item.id === id)?.fullName || '—';
  const paymentRows = payments.sort((a,b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0,15).map(item => `<tr><td>${escapeHtml(item.receivedAt)}</td><td>${escapeHtml(customerName(item.customerId))}</td><td>${escapeHtml(item.billId ? bills.find(bill => bill.id === item.billId)?.billNumber || 'Bill payment' : 'Unallocated payment')}</td><td>${escapeHtml(item.method || 'Cash')}</td><td>${currency(item.amount)}</td></tr>`);
  const billRows = bills.map(bill => {
    const paid = payments.filter(item => item.billId === bill.id).reduce((sum, item) => sum + Number(item.amount), 0);
    return `<tr><td>${escapeHtml(bill.billNumber)}</td><td>${escapeHtml(customerName(bill.customerId))}</td><td>${currency(bill.amount)}</td><td>${currency(paid)}</td><td>${currency(Math.max(0, bill.amount - paid))}</td><td>${button('Record payment', 'pay-bill', false, `data-id="${escapeHtml(bill.id)}"`)}</td></tr>`;
  });
  const expenseRows = expenses.sort((a,b) => b.incurredAt.localeCompare(a.incurredAt)).slice(0,10).map(item => `<tr><td>${escapeHtml(item.incurredAt)}</td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.description)}</td><td>${currency(item.amount)}</td></tr>`);
  return `${heading('CASH FLOW', 'Income & payments', `<div style="display:flex;gap:8px">${button('＋ Create bill','form-bill')}${button('＋ Record payment','form-customer-payment',true)}</div>`)}
    ${panel('Received payments',table(['Received','Customer','Reference','Method','Amount'],paymentRows,'No payments received yet. A bill is not income until payment is received.'))}
    <div style="height:16px"></div>${panel('Customer bills & outstanding balances',table(['Bill','Customer','Total','Received','Pending','Action'],billRows,'No customer bills yet.'))}
    <div style="height:16px"></div>${panel('Business expenses',`<div class="toolbar">${button('＋ Record expense','form-expense',true)}</div>${table(['Date','Category','Description','Amount'],expenseRows,'No expenses recorded.')}`)}`;
}

async function renderDetector() {
  const dates = selectedDateRange();
  const [summary, employeeBalances] = await Promise.all([financialSummary(dates.start, dates.end), salaryBalances()]);
  return `${heading('FINANCIAL HEALTH', 'Income detector', periodButtons())}
    <section class="panel"><div class="toolbar"><label class="field">From<input class="input" type="date" id="dateStart" value="${escapeHtml(dates.start)}"></label><label class="field">To<input class="input" type="date" id="dateEnd" value="${escapeHtml(dates.end)}"></label></div></section><div style="height:14px"></div>
    <div class="cards">
      ${cardMetric('Income actually received', currency(summary.received), 'Customer payments in selected dates', '↗', true)}
      ${cardMetric('Recorded expenses', currency(summary.expenses), 'Expenses paid in selected dates', '↘')}
      ${cardMetric('Business profit', currency(summary.profit), 'Received income − paid expenses', '◔', summary.profit >= 0)}
      ${cardMetric('Pending customer bills', currency(summary.pendingCustomerPayments), 'Not counted as received income', '◌')}
    </div><div class="dashboard-grid">
      ${panel('Income vs expenses', '<div class="chart-wrap"><canvas id="businessChart" aria-label="Income and expense summary"></canvas></div>')}
      ${panel('Still to pay: team salaries', `<div class="alert-list">${employeeBalances.filter(item => item.pending > 0).slice(0,6).map(item => `<div class="alert-item"><span class="alert-symbol">♙</span><div><strong>${escapeHtml(item.employee.fullName)}</strong><span>${currency(item.pending)} outstanding salary</span></div></div>`).join('') || '<div class="empty">No outstanding salary at this time.</div>'}</div>`)}
      ${panel('Expense breakdown',table(['Date','Category','Amount'],summary.expenseRows.map(item=>`<tr><td>${escapeHtml(item.incurredAt)}</td><td>${escapeHtml(item.source || item.category || item.description)}</td><td>${currency(item.amount)}</td></tr>`),'No expenses in the selected dates.'))}
    </div><div class="notice">Profit = payments actually received − direct expenses − salary payments − material purchases. Unpaid customer bills are excluded from income.</div>`;
}

async function renderAssistant() {
  const employees = await repository().list('employees');
  const customers = await repository().list('customers');
  const draft = state.draft;
  return `${heading('YOUR BUSINESS ASSISTANT', 'What happened at the workshop?', '')}
    <section class="panel"><div class="assistant-box">
      <p>Ask in English, Tamil, or Tanglish about employees, salary, stock, purchases, customers, projects, income, expenses, profit, reports, or sync status. You can also ask to open an app module.</p>
      <div class="assistant-conversation" aria-live="polite">${state.chat.map(message => `<div class="chat-message ${message.role === 'user' ? 'chat-user' : 'chat-assistant'} ${message.error ? 'chat-error' : ''}"><span>${message.role === 'user' ? 'You' : 'MD WELDERS'}</span><p>${escapeHtml(message.text)}</p></div>`).join('')}${state.assistantThinking ? '<div class="chat-message chat-assistant thinking"><span>MD WELDERS</span><p>Checking your saved records…</p></div>' : ''}</div>
      <label class="field full">Message<textarea class="textarea" rows="3" id="assistantText" placeholder="Example: Who has pending salary? / யாருக்கு சம்பளம் கொடுக்க வேண்டும்?"></textarea></label>
      <div class="assistant-controls"><label class="voice-language">Voice language<select class="select" id="voiceLanguage" aria-label="Voice input language"><option value="ta-IN" ${state.voiceLanguage === 'ta-IN' ? 'selected' : ''}>தமிழ்</option><option value="en-IN" ${state.voiceLanguage === 'en-IN' ? 'selected' : ''}>English / Tanglish</option><option value="en-US" ${state.voiceLanguage === 'en-US' ? 'selected' : ''}>English (US)</option></select></label><button class="button button-primary" data-action="assistant-send" ${state.assistantThinking ? 'disabled' : ''}>Send</button><button class="button button-secondary ${state.voiceEnabled ? 'voice-enabled' : ''}" data-action="toggle-voice">${state.voiceEnabled ? '🔊 Voice on' : '🔇 Voice off'}</button></div>
      <div class="notice">Answers use saved records on this device, including changes synchronized here. This local assistant does not send business data to an AI API. Pending sync may mean newer cloud changes are not present; unsupported modules and secrets are not exposed.</div>
      ${draft ? `<div class="draft"><h2>Review your transaction</h2>${draft.type==='salary'&&draft.employeeCount>1?`<div class="notice">This statement mentions ${draft.employeeCount} employees. To avoid guessing how to split the salary, record each employee’s payment separately using Salary Management.</div>`:''}<div class="form-grid">
        <label class="field">Type<select class="select" id="draftType"><option value="expense" ${draft.type === 'expense' ? 'selected' : ''}>Business expense</option><option value="salary" ${draft.type === 'salary' ? 'selected' : ''}>Salary payment</option><option value="income" ${draft.type === 'income' ? 'selected' : ''}>Customer payment received</option></select></label>
        <label class="field">Amount (₹)<input class="input" id="draftAmount" type="number" min="0.01" step="0.01" value="${escapeHtml(draft.amount)}"></label>
        <label class="field">Date<input class="input" id="draftDate" type="date" value="${escapeHtml(draft.date)}"></label>
        <label class="field">Category<input class="input" id="draftCategory" value="${escapeHtml(draft.category)}"></label>
        <label class="field">Employee<select class="select" id="draftEmployee"><option value="">Choose employee</option>${employees.map(item=>`<option value="${escapeHtml(item.id)}" ${draft.employeeId===item.id?'selected':''}>${escapeHtml(item.fullName)}</option>`).join('')}</select></label>
        <label class="field">Customer<select class="select" id="draftCustomer"><option value="">Choose customer</option>${customers.map(item=>`<option value="${escapeHtml(item.id)}" ${draft.customerId===item.id?'selected':''}>${escapeHtml(item.fullName)}</option>`).join('')}</select></label>
        <label class="field full">Description<textarea class="textarea" id="draftDescription" rows="2">${escapeHtml(draft.description)}</textarea></label>
      </div><div class="modal-actions"><button class="button button-secondary" data-action="discard-draft">Discard</button><button class="button button-primary" data-action="confirm-draft" ${draft.type==='salary'&&draft.employeeCount>1?'disabled':''}>✓ Confirm & save</button></div></div>` : ''}
    </div></section>`;
}

async function renderReports() {
  const dates = selectedDateRange();
  const [all, summary, employees, work, materials, customers] = await Promise.all([
    getAllData(), financialSummary(dates.start, dates.end), salaryBalances(), repository().list('workOrders'), stockBalances(), customerBalances()
  ]);
  const incomeRows = all.customerPayments.filter(item => item.receivedAt >= dates.start && item.receivedAt <= dates.end)
    .map(item => `<tr><td>${escapeHtml(item.receivedAt)}</td><td>Customer payment</td><td>${currency(item.amount)}</td></tr>`);
  return `${heading('BUSINESS INTELLIGENCE','Reports & analytics',`<div style="display:flex;gap:8px">${button('Export CSV','export-csv')}${button('Export PDF','export-pdf',true)}</div>`)}
    <section class="panel"><div class="toolbar">${periodButtons()}<label class="field">From<input class="input" id="dateStart" type="date" value="${escapeHtml(dates.start)}"></label><label class="field">To<input class="input" id="dateEnd" type="date" value="${escapeHtml(dates.end)}"></label><button class="button button-secondary" data-action="report-filter">Apply dates</button></div>
    <div class="cards" style="margin-top:15px">${cardMetric('Received income',currency(summary.received),'Selected reporting period','↗',true)}${cardMetric('Paid expenses',currency(summary.expenses),'Selected reporting period','↘')}${cardMetric('Net profit',currency(summary.profit),'Received income minus expenses','◔',summary.profit>=0)}${cardMetric('Pending bills',currency(summary.pendingCustomerPayments),'Not included as income','◌')}</div>
    <div class="chart-wrap"><canvas id="businessChart"></canvas></div></section>
    <div style="height:16px"></div>${panel('Employee salary report',table(['Employee','Assigned salary','Paid','Pending'],employees.map(item=>`<tr><td>${escapeHtml(item.employee.fullName)}</td><td>${currency(item.accrued)}</td><td>${currency(item.paid)}</td><td>${currency(item.pending)}</td></tr>`),'No salary data yet.'))}
    <div style="height:16px"></div>${panel('Work orders',table(['Job','Date','Location','Status'],work.map(item=>`<tr><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.workDate)}</td><td>${escapeHtml(item.location)}</td><td>${badge(item.status)}</td></tr>`),'No work orders yet.'))}
    <div style="height:16px"></div>${panel('Stock on hand',table(['Material','Available','Low stock at','Purchase cost'],materials.map(item=>`<tr><td>${escapeHtml(item.material.name)}</td><td>${item.available} ${escapeHtml(item.material.unit)}</td><td>${item.material.lowStockThreshold}</td><td>${currency(item.purchaseExpense)}</td></tr>`),'No material records.'))}
    <div style="height:16px"></div>${panel('Customer balances',table(['Customer','Billed','Received','Outstanding'],customers.map(item=>`<tr><td>${escapeHtml(item.customer.fullName)}</td><td>${currency(item.billed)}</td><td>${currency(item.paid)}</td><td>${currency(item.pending)}</td></tr>`),'No customer balances.'))}
    <div style="height:16px"></div>${panel('Income received',table(['Date','Type','Received'],incomeRows,'No income received yet.'))}`;
}

async function renderBackup() {
  const counts = await getAllData();
  return `${heading('SAFE, PORTABLE DATA','Backup & restore','')}
    <section class="panel"><h2>Your information belongs to you</h2><p class="subtitle">Create a versioned JSON backup of your local business records. Download and store it somewhere safe; backup files contain sensitive business data.</p>
    <div class="notice">A restore replaces existing data on this device. The backup is validated first; if validation fails, existing records are untouched. Download a fresh backup before restoring.</div>
    <div class="cards" style="margin-top:18px">${Object.entries(counts).filter(([key])=>key!=='settings').map(([key,rows])=>cardMetric(key.replace(/[A-Z]/g,' $&'),String(rows.length),'Local records','◫')).join('')}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="button button-primary" data-action="backup-export">↓ Download backup</button><label class="button button-secondary" for="restoreFile">↑ Validate & restore</label><input id="restoreFile" type="file" accept=".json,application/json" hidden></div></section>`;
}

async function renderSettings() {
  const [sync, queue] = await Promise.all([syncStatus(), repository().pending()]);
  const apiConfigured = sync.configured;
  let remoteStatus = null;
  let remoteStatusError = '';
  if (sync.authenticated && sync.online) {
    try { remoteStatus = await remoteSyncStatus(); }
    catch (error) { remoteStatusError = error.message || 'Cloud sync status could not be loaded.'; }
  }
  const pendingDownload = remoteStatus?.pendingDownload ?? sync.pendingDownload;
  const conflicts = queue.filter(item => item.status === 'conflict');
  const failedChanges = queue.filter(item => item.status === 'failed');
  const syncStatusLabels = {
    synced: 'Synced',
    syncing: 'Syncing',
    offline: 'Offline',
    failed: 'Failed',
    pending: 'Pending',
    'authentication-required': 'Sign in required',
    'not-configured': 'Not configured'
  };
  const lastSync = sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString() : 'Never';
  const progressText = sync.progress.phase === 'uploading'
    ? `Uploading ${sync.progress.completed} of ${sync.progress.total} changes`
    : sync.progress.phase === 'downloading'
      ? `Downloaded ${sync.progress.completed} changes`
      : 'Idle';
  let devices = [];
  let deviceError = '';
  if (sync.authenticated) {
    try { devices = await registeredDevices(); }
    catch (error) { deviceError = error.message || 'Registered devices could not be loaded.'; }
  }
  if (sync.authenticated) {
    const currentSync = await syncStatus();
    if (!currentSync.authenticated) {
      sync.authenticated = false;
      sync.status = currentSync.status;
    }
  }
  const deviceRows = devices.map(device => {
    const deviceId = device.deviceId || device.id;
    const current = device.current === true || deviceId === sync.deviceId;
    const access = current ? 'Current' : device.revokedAt
      ? 'Revoked'
      : `<button class="button button-danger button-small" data-action="revoke-device" data-id="${escapeHtml(deviceId)}">Revoke</button>`;
    return `<tr><td>${escapeHtml(device.deviceName || device.name || 'Device')}${current ? ' (this device)' : ''}</td><td>${escapeHtml(device.platform || '—')}</td><td>${escapeHtml(device.lastSeenAt || device.createdAt || '—')}</td><td>${access}</td></tr>`;
  });
  const failedRows = failedChanges.map(item => `<tr><td>${escapeHtml(item.entityType)} · ${escapeHtml(item.recordId.slice(0, 8))}</td><td>${escapeHtml(item.error || 'Retry required.')}</td><td><button class="button button-secondary button-small" data-action="sync">Retry</button></td></tr>`);
  return `${heading('PREFERENCES & SECURITY','Settings','')}
    <section class="panel"><h2>Sync & connectivity</h2><p class="subtitle">Your business records stay on this device when the internet is unavailable.</p>
      <div class="alert-list" style="margin-top:15px">
        <div class="alert-item"><span class="alert-symbol">●</span><div><strong>${sync.online ? 'Online · இணையம் உள்ளது' : 'Offline · இணையம் இல்லை'}</strong><span>Local data entry remains available either way.</span></div></div>
        <div class="alert-item"><span class="alert-symbol">↻</span><div><strong>${apiConfigured ? 'Secure cloud API configured' : 'Cloud sync not configured'}</strong><span>${apiConfigured ? 'Automatic sync runs when connected and signed in.' : 'Set VITE_API_BASE_URL to the HTTPS Spring Boot API address.'}</span></div></div>
        <div class="alert-item"><span class="alert-symbol">◈</span><div><strong>Sync status: ${syncStatusLabels[sync.status] || 'Pending'} · Last successful sync: ${escapeHtml(lastSync)}</strong><span>${sync.pending} pending upload · ${pendingDownload === null ? 'download count unknown' : `${pendingDownload} pending download`} · ${remoteStatus ? `${remoteStatus.recordCount} cloud records` : ''} · ${sync.uploaded} uploaded · ${sync.downloaded} downloaded · ${sync.failed} failed · ${sync.conflicts} conflicts · ${escapeHtml(progressText)}.</span></div></div>
        <div class="alert-item"><span class="alert-symbol">▣</span><div><strong>${escapeHtml(sync.deviceName)}</strong><span>Device ID: ${escapeHtml(sync.deviceId)}</span></div></div>
        ${sync.lastError ? `<div class="notice" role="status">Last sync error: ${escapeHtml(sync.lastError)}</div>` : ''}
        ${remoteStatusError ? `<div class="notice notice-error" role="status">Cloud status error: ${escapeHtml(remoteStatusError)}</div>` : ''}
      </div><div style="display:flex;gap:8px;margin-top:16px">${button(sync.failed ? '↻ Retry sync' : '↻ Sync now','sync',true)}${button('Open backup & restore','page-Backup')}</div>
      ${sync.authenticated ? `<div style="display:flex;gap:8px;margin-top:12px">${button('Sign out this device','sync-logout')}</div>` : `<div class="notice" style="margin-top:14px">Sign in once to authorize this device. The password is not stored; session tokens are protected by Android Keystore on this device.</div><div class="form-grid" style="margin-top:12px"><label class="field">Business account username<input id="syncUsername" autocomplete="username"></label><label class="field">Password<input id="syncPassword" type="password" autocomplete="current-password"></label><div><button class="button button-primary" data-action="connect-sync">Connect this device</button></div></div>`}
    </section>
    ${sync.authenticated ? `<div style="height:16px"></div>${panel('Registered devices',deviceError ? `<div class="notice notice-error">${escapeHtml(deviceError)}</div>` : table(['Device','Platform','Last seen','Access'],deviceRows,'No registered devices returned.'))}` : ''}
    ${failedChanges.length ? `<div style="height:16px"></div>${panel('Failed sync records',table(['Record','Error','Action'],failedRows,'No failed records.'))}` : ''}
    ${conflicts.length?`<div style="height:16px"></div>${panel('Resolve cloud conflicts',`<div class="notice">Choose which version to keep. “Keep this device” updates its base version and retries on the next sync. “Use cloud” replaces this local record.</div>${table(['Record','Conflict','Resolution'],conflicts.map(item=>`<tr><td>${escapeHtml(item.entityType)} · ${escapeHtml(item.recordId.slice(0,8))}</td><td>${escapeHtml(item.error||'A newer cloud version exists.')}</td><td><button class="button button-secondary button-small" data-action="resolve-cloud" data-id="${escapeHtml(item.queueId)}">Use cloud</button> <button class="button button-primary button-small" data-action="resolve-local" data-id="${escapeHtml(item.queueId)}">Keep this device</button></td></tr>`),'No unresolved conflicts.')}`)}`:''}
    <div style="height:16px"></div><section class="panel"><h2>Security notes</h2><ul class="subtitle" style="line-height:2"><li>Passwords are used only for sign-in and are never saved to local storage.</li><li>Android session tokens are encrypted with an Android Keystore key.</li><li>Cloud access uses a business-scoped session and HTTPS in production.</li></ul></section>`;
}

function drawChart() {
  const canvas = document.querySelector('#businessChart');
  if (!canvas) return;
  if (state.chart) state.chart.destroy();
  const months = [];
  const cursor = new Date();
  for (let index = 5; index >= 0; index -= 1) {
    const date = new Date(cursor.getFullYear(), cursor.getMonth() - index, 1);
    months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  }
  Promise.all([
    repository().list('customerPayments'),
    repository().list('expenses'),
    repository().list('salaryPayments'),
    repository().list('stockTransactions')
  ]).then(([payments, expenses, salary, stock]) => {
    if (!canvas.isConnected) return;
    state.chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: months.map(month => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' })),
        datasets: [
          { label: 'Income received', data: months.map(month => payments.filter(item => item.receivedAt.startsWith(month)).reduce((sum, item) => sum + Number(item.amount), 0)), backgroundColor: '#21855e', borderRadius: 5 },
          { label: 'Expenses', data: months.map(month =>
            expenses.filter(item => item.incurredAt.startsWith(month)).reduce((sum, item) => sum + Number(item.amount), 0) +
            salary.filter(item => item.paidAt.startsWith(month)).reduce((sum, item) => sum + Number(item.amount), 0) +
            stock.filter(item => item.type === 'PURCHASE' && item.occurredAt.startsWith(month)).reduce((sum, item) => sum + Number(item.amount || 0), 0)
          ), backgroundColor: '#e8792d', borderRadius: 5 }
        ]
      },
      options: { maintainAspectRatio: false, responsive: true, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 7, font: { size: 10 } } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: value => `₹${Number(value).toLocaleString('en-IN')}`, font: { size: 9 } } } } }
    });
  }).catch(error => notify(error.message, true));
}

function notify(message, error = false) {
  const host = document.querySelector('#toastHost');
  if (!host) return;
  clearTimeout(state.toastTimer);
  host.innerHTML = `<div role="status" class="toast ${error ? 'error' : ''}">${escapeHtml(message)}</div>`;
  state.toastTimer = setTimeout(() => { host.innerHTML = ''; }, 4000);
}

function field(label, name, type = 'text', options = {}) {
  const required = options.required === false ? '' : 'required';
  const full = options.full ? 'full' : '';
  if (type === 'select') {
    return `<label class="field ${full}">${escapeHtml(label)}<select class="select" name="${escapeHtml(name)}" ${required}>${options.empty ? '<option value="">Choose...</option>' : ''}${(options.items || []).map(item => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join('')}</select></label>`;
  }
  if (type === 'textarea') return `<label class="field ${full}">${escapeHtml(label)}<textarea class="textarea" name="${escapeHtml(name)}" rows="2" ${required}></textarea></label>`;
  const defaultValue = type === 'date' && options.defaultToday !== false ? `value="${today()}"` : '';
  return `<label class="field ${full}">${escapeHtml(label)}<input class="input" name="${escapeHtml(name)}" type="${type}" ${defaultValue} ${options.min !== undefined ? `min="${options.min}"` : ''} ${options.maxLength ? `maxlength="${options.maxLength}"` : ''} ${options.step ? `step="${options.step}"` : ''} ${required}></label>`;
}

function decorateVoiceInputs(root) {
  const selector = 'input[type="text"], input[type="search"], input[type="email"], input[type="tel"], input[type="url"], textarea';
  const fields = [
    ...(root.matches?.(selector) ? [root] : []),
    ...root.querySelectorAll(selector)
  ];
  for (const input of fields) {
    if (input.dataset.voiceReady || input.closest('.voice-input-wrap')) continue;
    const wrapper = document.createElement('span');
    wrapper.className = 'voice-input-wrap';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.append(input);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'voice-input-button';
    button.dataset.action = 'voice-field';
    button.setAttribute('aria-label', `Dictate into ${input.getAttribute('aria-label') || input.placeholder || input.name || 'this field'}`);
    button.title = 'Voice type';
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v4m-4 0h8"/></svg>';
    wrapper.append(button);
    const status = document.createElement('span');
    status.className = 'voice-input-status';
    status.setAttribute('aria-live', 'polite');
    wrapper.append(status);
    input.dataset.voiceReady = 'true';
  }
}

async function openForm(kind, id = '') {
  let type = kind.startsWith('edit:') ? kind.slice(5) : kind;
  const formAliases = {
    employee: 'employees',
    customer: 'customers',
    material: 'materials',
    work: 'workOrders',
    'customer-payment': 'customerPayment',
    'salary-payment': 'salaryPayment'
  };
  type = formAliases[type] || type;
  if (type === 'salaryPaymentByEmployee') {
    type = 'salaryPayment';
    state.preselectedEmployeeId = id;
  }
  const existing = id && kind.startsWith('edit:') ? await repository().get(type, id) : null;
  const [employees, customers, materials, orders, bills, assignments, allEmployees] = await Promise.all([
    repository().list('employees'), repository().list('customers'), repository().list('materials'),
    repository().list('workOrders'), repository().list('bills'), repository().list('assignments'),
    repository().list('employees', true)
  ]);
  let title = '', fields = '', save = null;
  const choose = (items, labelKey = 'fullName') => items.map(item => ({ value: item.id, label: item[labelKey] }));
  switch (type) {
    case 'employees':
      title = existing ? 'Edit employee' : 'Add employee';
      fields = field('Employee name','fullName','text',{maxLength:160})+field('Phone number','phone','tel',{required:false,maxLength:40})+field('Daily salary (₹)','dailySalary','number',{min:'0.01',step:'0.01'})+field('Joining date','joiningDate','date',{required:false,defaultToday:false})+field('Address','address','textarea',{full:true,required:false})+field('Location','location','text',{required:false,maxLength:200})+field('Job role','role','text',{required:false,maxLength:80})+field('Profile photo URL (optional)','photoUri','url',{required:false});
      fields += `<label class="field full">Employee photo<input class="input" type="file" id="photoUpload" accept="image/*" capture="environment"><span class="subtitle">Optional. The image is resized and stored only on this device.</span></label>`;
      save = async data => existing ? updateRecord(type,id,{...data,dailySalary:Number(data.dailySalary),photoUri:state.photoData||data.photoUri}) : saveRecord(type,{...data,dailySalary:Number(data.dailySalary),photoUri:state.photoData||data.photoUri,isActive:true});
      break;
    case 'customers':
      title = existing ? 'Edit customer' : 'Add customer';
      fields = field('Customer name','fullName')+field('Phone number','phone','tel',{required:false})+field('Email','email','email',{required:false})+field('Address','address','textarea',{full:true,required:false})+field('Location','location','text',{required:false});
      save = data => existing ? updateRecord(type,id,data) : saveRecord(type,data);
      break;
    case 'materials':
      title = existing ? 'Edit material' : 'Add material';
      fields = field('Material name','name')+field('Unit (kg, pieces, metres)','unit')+field('Low-stock alert at','lowStockThreshold','number',{min:'0',step:'0.001'})+field('Notes','notes','textarea',{full:true,required:false});
      save = data => existing ? updateRecord(type,id,{...data,lowStockThreshold:Number(data.lowStockThreshold)}) : saveRecord(type,{...data,lowStockThreshold:Number(data.lowStockThreshold)});
      break;
    case 'workOrders':
      title = existing ? 'Edit work order' : 'Create work order';
      fields = field('Job name','title')+field('Customer','customerId','select',{empty:true,required:false,items:choose(customers)})+field('Job location','location','text',{full:true,required:false})+field('Work date','workDate','date')+field('Status','status','select',{items:[{value:'PENDING',label:'Pending'},{value:'IN_PROGRESS',label:'In progress'},{value:'COMPLETED',label:'Completed'},{value:'CANCELLED',label:'Cancelled'}]});
      save = data => existing ? updateRecord(type,id,data) : createWorkOrder(data);
      break;
    case 'salaryPayment':
      title = 'Record salary payment';
      fields = field('Employee','employeeId','select',{empty:true,items:choose(employees)})+field('Amount (₹)','amount','number',{min:'0.01',step:'0.01'})+field('Payment date','paidAt','date')+field('Note','note','textarea',{full:true,required:false});
      save = recordSalaryPayment;
      break;
    case 'customerPayment':
      title = 'Record customer payment received';
      fields = field('Customer','customerId','select',{empty:true,items:choose(customers)})+field('Bill (optional)','billId','select',{empty:true,required:false,items:choose(bills,'billNumber')})+field('Amount received (₹)','amount','number',{min:'0.01',step:'0.01'})+field('Received date','receivedAt','date')+field('Method','method','select',{items:['Cash','Bank transfer','UPI','Cheque','Other'].map(value=>({value,label:value}))})+field('Note','note','textarea',{full:true,required:false});
      save = recordCustomerPayment;
      break;
    case 'bill':
      title = 'Create customer bill';
      fields = field('Customer','customerId','select',{empty:true,items:choose(customers)})+field('Work order (optional)','workOrderId','select',{empty:true,required:false,items:choose(orders,'title')})+field('Bill number (optional)','billNumber','text',{required:false})+field('Total (₹)','amount','number',{min:'0.01',step:'0.01'})+field('Issue date','issuedAt','date')+field('Description','description','textarea',{full:true,required:false});
      save = createBill;
      break;
    case 'expense':
      title = 'Record business expense';
      fields = field('Description','description')+field('Category','category','select',{items:['General','Tools','Transport','Utilities','Rent','Maintenance','Other'].map(value=>({value,label:value}))})+field('Amount (₹)','amount','number',{min:'0.01',step:'0.01'})+field('Date paid','incurredAt','date');
      save = recordExpense;
      break;
    case 'purchase':
      title = 'Record material purchase';
      fields = field('Material','materialId','select',{empty:true,items:choose(materials,'name')})+field('Quantity','quantity','number',{min:'0.001',step:'0.001'})+field('Unit cost (₹)','unitCost','number',{min:'0',step:'0.01'})+field('Purchase date','occurredAt','date')+field('Note','note','textarea',{full:true,required:false});
      save = createMaterialPurchase;
      break;
    case 'usage':
      title = 'Record material usage';
      fields = field('Material','materialId','select',{empty:true,items:choose(materials,'name')})+field('Quantity used','quantity','number',{min:'0.001',step:'0.001'})+field('Work order (optional)','workOrderId','select',{empty:true,required:false,items:choose(orders,'title')})+field('Date used','occurredAt','date')+field('Note','note','textarea',{full:true,required:false});
      save = recordMaterialUsage;
      break;
    default:
      throw new Error(`Unsupported form: ${type}.`);
  }
  state.photoData = null;
  const existingWorkerIds = new Set(existing
    ? assignments.filter(assignment => assignment.workOrderId === id).map(assignment => assignment.employeeId)
    : []);
  if (type === 'workOrders') {
    const workers = allEmployees.filter(employee =>
      employee.deleted !== true && employee.isActive !== false || existingWorkerIds.has(employee.id)
    );
    fields += `<fieldset class="field full worker-fieldset" id="workerSelection">
      <legend>Assign workers</legend>
      <div class="worker-toolbar"><span class="subtitle">Choose who will work on this project.</span>
        <div class="worker-actions"><button type="button" class="button button-secondary button-small" data-action="worker-select-all">Select all</button><button type="button" class="button button-secondary button-small" data-action="worker-deselect-all">Deselect all</button></div>
      </div>
      <div class="worker-list">${workers.length ? workers.map(employee => `<label class="worker-option" data-employee-id="${escapeHtml(employee.id)}">
        <input type="checkbox" name="employeeIds" value="${escapeHtml(employee.id)}" ${existingWorkerIds.has(employee.id) ? 'checked' : ''}>
        <span class="worker-info"><strong>${escapeHtml(employee.fullName)}${employee.deleted || employee.isActive === false ? ' · Inactive' : ''}</strong><span>${escapeHtml(employee.role || 'Worker')} · ${currency(employee.dailySalary)}/day</span></span>
        <span class="worker-availability" aria-live="polite"></span>
      </label>`).join('') : '<div class="empty worker-empty">No employees available. Add an employee before assigning project workers.</div>'}</div>
      <div class="worker-footer"><span id="selectedWorkerCount" aria-live="polite">Selected workers: ${existingWorkerIds.size}</span><span class="subtitle" id="teamAvailability">Employees already assigned to another active project on this date cannot be added.</span></div>
    </fieldset>`;
  }
  document.querySelector('#overlay').innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><h2 id="modalTitle">${escapeHtml(title)}</h2><form id="recordForm"><div class="form-grid">${fields}</div><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit">Save locally</button></div></form></section></div>`;
  decorateVoiceInputs(document.querySelector('#overlay'));
  const form = document.querySelector('#recordForm');
  if (existing) for (const [key,value] of Object.entries(existing)) {
    const input=form.elements.namedItem(key);
    if (input) input.value=value;
  }
  if (state.preselectedEmployeeId) {
    const employee = form.elements.namedItem('employeeId');
    if (employee) employee.value = state.preselectedEmployeeId;
    state.preselectedEmployeeId = '';
  }
  const updateWorkerAvailability = () => {
    const date = form.elements.namedItem('workDate')?.value || today();
    const workerSelection = document.querySelector('#workerSelection');
    if (!workerSelection) return;
    const activeOrders = new Set(orders.filter(order => order.status !== 'CANCELLED').map(order => order.id));
    for (const checkbox of workerSelection.querySelectorAll('input[name="employeeIds"]')) {
      const assignedHere = existingWorkerIds.has(checkbox.value);
      const busy = assignments.some(item =>
        item.employeeId === checkbox.value &&
        item.workOrderId !== id &&
        item.workDate === date &&
        activeOrders.has(item.workOrderId)
      );
      const employee = allEmployees.find(item => item.id === checkbox.value);
      const unavailable = employee?.deleted === true || employee?.isActive === false;
      checkbox.disabled = !checkbox.checked && (busy || unavailable);
      const status = checkbox.closest('.worker-option')?.querySelector('.worker-availability');
      if (status) status.textContent = busy ? 'Already assigned that day' : unavailable && !assignedHere ? 'Unavailable' : assignedHere ? 'Assigned' : 'Available';
    }
    const count = workerSelection.querySelectorAll('input[name="employeeIds"]:checked').length;
    const counter = document.querySelector('#selectedWorkerCount');
    if (counter) counter.textContent = `Selected workers: ${count}`;
  };
  form.elements.namedItem('workDate')?.addEventListener('change', updateWorkerAvailability);
  document.querySelector('#workerSelection')?.addEventListener('change', updateWorkerAvailability);
  updateWorkerAvailability();
  document.querySelector('#photoUpload')?.addEventListener('change', async event => {
    try { state.photoData=await resizePhoto(event.target.files?.[0]); }
    catch(error) { notify(error.message,true);event.target.value=''; }
  });
  let submitting = false;
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    const values=Object.fromEntries(new FormData(form));
    if (type === 'workOrders') values.employeeIds = [...form.querySelectorAll('input[name="employeeIds"]:checked')].map(input => input.value);
    try { await save(values);state.photoData=null;closeModal();await renderPage();notify('Saved on this device. It will sync when connected.'); }
    catch(error) { notify(error.message,true); }
    finally { submitting = false; if (submitButton.isConnected) submitButton.disabled = false; }
  });
}

function closeModal() { document.querySelector('#overlay').innerHTML=''; }

async function confirmDraft() {
  const draft={
    type:document.querySelector('#draftType')?.value,
    amount:Number(document.querySelector('#draftAmount')?.value),
    date:document.querySelector('#draftDate')?.value,
    category:document.querySelector('#draftCategory')?.value,
    employeeId:document.querySelector('#draftEmployee')?.value,
    customerId:document.querySelector('#draftCustomer')?.value,
    description:document.querySelector('#draftDescription')?.value
  };
  await confirmAssistantDraft(draft);
  state.draft=null;
  state.chat.push({ role: 'assistant', text: 'Confirmed and saved to the local business records.', intent: 'transaction' });
  await renderPage();
  notify('Confirmed and saved locally.');
}

async function sendAssistantMessage() {
  const input = document.querySelector('#assistantText');
  const text = input?.value.trim();
  if (!text || state.assistantThinking) return;
  const context = [...state.chat];
  context.push({ role: 'user', text });
  state.chat = context.slice(-24);
  state.draft = null;
  state.assistantThinking = true;
  await renderPage();
  let responseText = '';
  try {
    const result = await answerAssistant(text, context);
    responseText = result.response;
    state.draft = result.draft || null;
    state.chat.push({ role: 'assistant', text: result.response, intent: result.intent, period: result.period, context: result.context });
    if (result.navigateTo) state.page = result.navigateTo;
  } catch (error) {
    responseText = error.message || 'The assistant could not answer that request.';
    state.chat.push({ role: 'assistant', text: responseText, error: true });
  } finally {
    state.assistantThinking = false;
    state.chat = state.chat.slice(-24);
    await renderPage();
  }
  if (state.voiceEnabled && responseText) speak(responseText, state.voiceLanguage);
}

async function exportBackup() {
  const backup={format:'md-welders-backup',schemaVersion:1,exportedAt:new Date().toISOString(),data:await getAllData()};
  const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;
  link.download=`md-welders-backup-${today()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('Backup downloaded.');
}

async function restoreBackup(file) {
  if (!file) return;
  try {
    const data=JSON.parse(await file.text());
    if (!window.confirm('Restore this backup? Existing local records will be replaced after validation.')) return;
    await restoreAllData(data);
    await renderPage();
    notify('Backup restored successfully.');
  } catch(error) { notify(error.message || 'The backup could not be restored.',true); }
}

async function updateSyncLabel() {
  try {
    const sync=await syncStatus();
    const label=document.querySelector('#syncLabel');
    const side=document.querySelector('#sideSync');
    const labels = {
      synced: 'Synced',
      syncing: 'Syncing…',
      offline: 'Offline',
      failed: 'Sync failed',
      pending: 'Pending',
      'authentication-required': 'Sign in required',
      'not-configured': 'Cloud sync not configured'
    };
    const downloads = Number(sync.pendingDownload || 0);
    if (label) label.textContent = `${labels[sync.status] || 'Pending'} · ${sync.pending + downloads} pending`;
    if (side) side.textContent = `${sync.pending} upload · ${sync.pendingDownload === null ? 'downloads unknown' : `${downloads} download`} · ${sync.failed} failed · ${sync.conflicts} conflicts`;
    document.querySelector('[data-action="sync"]')?.classList.toggle('syncing', sync.status === 'syncing');
  } catch (error) { notify(error.message,true); }
}

function downloadCsv() {
  const rows=[...document.querySelectorAll('table tr')].map(row=>[...row.querySelectorAll('th,td')].map(cell=>{const value=cell.innerText.replaceAll('"','""');return `"${/^[\t\r\n ]*[=+\-@]/.test(value)?`'${value}`:value}"`;}).join(',')).join('\r\n');
  const link=document.createElement('a');
  link.href=URL.createObjectURL(new Blob([`\uFEFF${rows}`],{type:'text/csv;charset=utf-8'}));
  link.download=`md-welders-report-${today()}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function printReport() { window.print(); }

async function showEmployeeDetails(id) {
  const employee=await repository().get('employees',id);
  if(!employee)throw new Error('Employee not found.');
  const [work,assignments,payments]=await Promise.all([repository().list('workOrders'),repository().list('assignments'),repository().list('salaryPayments')]);
  const history=assignments.filter(item=>item.employeeId===id).sort((a,b)=>b.workDate.localeCompare(a.workDate)).map(item=>`<tr><td>${escapeHtml(item.workDate)}</td><td>${escapeHtml(work.find(order=>order.id===item.workOrderId)?.title||'—')}</td><td>${currency(item.dailyRate)}</td></tr>`);
  const salaryHistory=payments.filter(item=>item.employeeId===id).sort((a,b)=>b.paidAt.localeCompare(a.paidAt)).map(item=>`<tr><td>${escapeHtml(item.paidAt)}</td><td>${currency(item.amount)}</td><td>${escapeHtml(item.note||'—')}</td></tr>`);
  document.querySelector('#overlay').innerHTML=`<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true"><h2>${escapeHtml(employee.fullName)}</h2>${employee.photoUri?`<img src="${escapeHtml(employee.photoUri)}" alt="${escapeHtml(employee.fullName)}" style="width:92px;height:92px;object-fit:cover;border-radius:50%;margin-bottom:14px">`:''}<div class="draft-row"><span>Job role</span><strong>${escapeHtml(employee.role||'—')}</strong></div><div class="draft-row"><span>Phone</span><strong>${escapeHtml(employee.phone||'—')}</strong></div><div class="draft-row"><span>Address</span><strong>${escapeHtml(employee.address||'—')}</strong></div><div class="draft-row"><span>Location</span><strong>${escapeHtml(employee.location||'—')}</strong></div><div class="draft-row"><span>Joined</span><strong>${escapeHtml(employee.joiningDate||'—')}</strong></div><div class="draft-row"><span>Daily salary</span><strong>${currency(employee.dailySalary)}</strong></div><h2 style="margin-top:18px">Work history</h2>${table(['Date','Work order','Salary accrued'],history,'No work history yet.')}<h2 style="margin-top:18px">Salary payments</h2>${table(['Date','Amount','Note'],salaryHistory,'No salary payments yet.')}<div class="modal-actions"><button class="button button-secondary" data-action="close-modal">Close</button></div></section></div>`;
}

async function showWorkDetails(id) {
  const [workOrder, assignments, employees, customers] = await Promise.all([
    repository().get('workOrders', id),
    repository().list('assignments'),
    repository().list('employees', true),
    repository().list('customers')
  ]);
  if (!workOrder) throw new Error('Project not found.');
  const assignedWorkers = assignments.filter(item => item.workOrderId === id).map(item => {
    const employee = employees.find(record => record.id === item.employeeId);
    return `<tr><td>${escapeHtml(employee?.fullName || 'Former employee')}</td><td>${escapeHtml(employee?.role || '—')}</td><td>${currency(item.dailyRate)}</td><td>${escapeHtml(item.workDate)}</td></tr>`;
  });
  const customer = customers.find(item => item.id === workOrder.customerId);
  document.querySelector('#overlay').innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="workDetailTitle">
    <h2 id="workDetailTitle">${escapeHtml(workOrder.title)}</h2>
    <div class="draft-row"><span>Customer</span><strong>${escapeHtml(customer?.fullName || '—')}</strong></div>
    <div class="draft-row"><span>Location</span><strong>${escapeHtml(workOrder.location || '—')}</strong></div>
    <div class="draft-row"><span>Work date</span><strong>${escapeHtml(workOrder.workDate)}</strong></div>
    <div class="draft-row"><span>Status</span><strong>${escapeHtml(workOrder.status)}</strong></div>
    <h2 style="margin-top:18px">Assigned workers</h2>${table(['Worker','Job role','Daily rate','Work date'],assignedWorkers,'No workers are assigned to this project.')}
    <div class="modal-actions"><button class="button button-secondary" data-action="close-modal">Close</button><button class="button button-primary" data-action="edit" data-table="workOrders" data-id="${escapeHtml(id)}">Edit project</button></div>
  </section></div>`;
}

async function showCustomerDetails(id) {
  const customer=await repository().get('customers',id);
  if(!customer)throw new Error('Customer not found.');
  const [work,bills,payments]=await Promise.all([repository().list('workOrders'),repository().list('bills'),repository().list('customerPayments')]);
  const customerWork=work.filter(item=>item.customerId===id).sort((a,b)=>b.workDate.localeCompare(a.workDate)).map(item=>`<tr><td>${escapeHtml(item.workDate)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.location||'—')}</td><td>${badge(item.status)}</td></tr>`);
  const customerBills=bills.filter(item=>item.customerId===id).sort((a,b)=>b.issuedAt.localeCompare(a.issuedAt)).map(bill=>{
    const paid=payments.filter(payment=>payment.billId===bill.id).reduce((sum,payment)=>sum+Number(payment.amount),0);
    return `<tr><td>${escapeHtml(bill.billNumber)}</td><td>${escapeHtml(bill.issuedAt)}</td><td>${currency(bill.amount)}</td><td>${currency(paid)}</td><td>${currency(Math.max(0,Number(bill.amount)-paid))}</td></tr>`;
  });
  const customerPayments=payments.filter(item=>item.customerId===id).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)).map(item=>`<tr><td>${escapeHtml(item.receivedAt)}</td><td>${escapeHtml(item.method||'Cash')}</td><td>${escapeHtml(bills.find(bill=>bill.id===item.billId)?.billNumber||'Unallocated payment')}</td><td>${currency(item.amount)}</td></tr>`);
  document.querySelector('#overlay').innerHTML=`<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true"><h2>${escapeHtml(customer.fullName)}</h2><div class="draft-row"><span>Phone</span><strong>${escapeHtml(customer.phone||'—')}</strong></div><div class="draft-row"><span>Email</span><strong>${escapeHtml(customer.email||'—')}</strong></div><div class="draft-row"><span>Address</span><strong>${escapeHtml(customer.address||'—')}</strong></div><div class="draft-row"><span>Location</span><strong>${escapeHtml(customer.location||'—')}</strong></div><h2 style="margin-top:18px">Work history</h2>${table(['Date','Work order','Location','Status'],customerWork,'No customer work history yet.')}<h2 style="margin-top:18px">Bills & balances</h2>${table(['Bill','Issued','Total','Paid','Pending'],customerBills,'No customer bills yet.')}<h2 style="margin-top:18px">Payment history</h2>${table(['Received','Method','Reference','Amount'],customerPayments,'No payments received yet.')}<div class="modal-actions"><button class="button button-secondary" data-action="close-modal">Close</button></div></section></div>`;
}

app.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action],[data-page]');
  if (!button) return;
  if (button.hasAttribute('data-page')) { if(isVoiceInputActive())await stopVoiceInput();state.page=button.dataset.page;state.search='';state.draft=null;document.querySelector('#sidebar').classList.remove('open');await renderPage();return; }
  const { action,id,table }=button.dataset;
  try {
    if (action==='menu') document.querySelector('#sidebar').classList.toggle('open');
    else if (action==='refresh') await renderPage();
    else if (action==='close-modal') { if(event.target===button||event.target.classList.contains('modal-backdrop')) {if(isVoiceInputActive())await stopVoiceInput();closeModal();} }
    else if (action.startsWith('page-')) { if(isVoiceInputActive())await stopVoiceInput();state.page=action.slice(5);state.draft=null;await renderPage(); }
    else if (action.startsWith('form-')) await openForm(action.slice(5));
    else if (action==='edit') await openForm(`edit:${table}`,id);
    else if (action==='voice-field') await captureVoice(button.closest('.voice-input-wrap')?.querySelector('input,textarea'));
    else if (action==='delete') {
      const label=table==='employees'?'employee':table==='customers'?'customer':table==='materials'?'material':'work order';
      if(window.confirm(`Delete this ${label}? Historical payments and stock movements will be retained.`)){await removeRecord(table,id);await renderPage();notify('Record deleted locally.')}
    }
    else if(action==='employee-detail') await showEmployeeDetails(id);
    else if(action==='customer-detail') await showCustomerDetails(id);
    else if(action==='work-detail') await showWorkDetails(id);
    else if(action==='worker-select-all'||action==='worker-deselect-all') {
      const select = action === 'worker-select-all';
      for (const checkbox of document.querySelectorAll('#workerSelection input[name="employeeIds"]')) {
        if (select && checkbox.disabled) continue;
        checkbox.checked = select;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    else if(action==='resolve-cloud'||action==='resolve-local') {
      const resolution=action==='resolve-cloud'?'cloud':'local';
      const prompt=resolution==='cloud'?'Replace this device’s copy with the latest cloud record?':'Keep this device’s copy and retry it against the latest cloud version?';
      if(window.confirm(prompt)){await repository().resolveConflict(id,resolution);await renderPage();await updateSyncLabel();notify(resolution==='cloud'?'Cloud version applied.':'Local version kept and queued for sync.');}
    }
    else if (action==='pay-employee') await openForm('salaryPaymentByEmployee',id);
    else if (action==='pay-bill') {
      const bill=await repository().get('bills',id);
      await openForm('customerPayment');
      const customer=document.querySelector('[name="customerId"]');if(customer)customer.value=bill.customerId;
      const billSelect=document.querySelector('[name="billId"]');if(billSelect)billSelect.value=id;
    }
    else if (action==='sync') {
      button.disabled=true;
      const label=document.querySelector('#syncLabel');
      if(label)label.textContent='Syncing...';
      button.classList.add('syncing');
      try {
        const result=await syncNow();
        await renderPage();
        notify(`Sync complete: ${result.applied} uploaded, ${result.received} downloaded, ${result.failed} failed, ${result.conflicts} conflicts.`);
      } finally {
        button.disabled=false;
        button.classList.remove('syncing');
        await updateSyncLabel();
        if(state.page==='Settings')await renderPage();
      }
    }
    else if (action==='connect-sync') {
      button.disabled=true;
      try {
        const username=document.querySelector('#syncUsername')?.value;
        const passwordInput=document.querySelector('#syncPassword');
        const password=passwordInput?.value;
        if(passwordInput)passwordInput.value='';
        await connectSync(username,password);
        const result=await syncNow();
        await renderPage();
        notify(`Device connected. ${result.applied} uploaded and ${result.received} downloaded.`);
      } finally {
        button.disabled=false;
      }
    }
    else if (action==='sync-logout') {
      if(window.confirm('Sign out and revoke this device session?')) {
        await logoutSync();
        await renderPage();
        notify('This device was signed out.');
      }
    }
    else if (action==='revoke-device') {
      if(window.confirm('Revoke this device’s access to the business account?')) {
        await revokeDevice(id);
        await renderPage();
        notify('Device access revoked.');
      }
    }
    else if (action==='assistant-send') await sendAssistantMessage();
    else if (action==='confirm-draft') {
      if(!window.confirm('Save this reviewed transaction to your local business records?'))return;
      await confirmDraft();
    }
    else if (action==='discard-draft') {state.draft=null;await renderPage();}
    else if (action==='toggle-voice') {
      state.voiceEnabled=!state.voiceEnabled;
      localStorage.setItem('mdwelders.voiceEnabled',String(state.voiceEnabled));
      if(!state.voiceEnabled)window.speechSynthesis?.cancel();
      await renderPage();
      notify(state.voiceEnabled?'Assistant voice responses enabled.':'Assistant voice responses disabled.');
    }
    else if (action==='backup-export') await exportBackup();
    else if (action==='export-csv') downloadCsv();
    else if (action==='export-pdf') printReport();
    else if (action==='report-filter') await renderPage();
    else if (action==='period') {state.period=button.dataset.period;await renderPage();}
  } catch(error) { notify(error.message,true); }
});

app.addEventListener('submit',event=>event.preventDefault());
app.addEventListener('input',event=>{
  if(event.target.id==='searchInput'){
    const position=event.target.selectionStart;
    state.search=event.target.value;
    clearTimeout(state.searchTimer);
    state.searchTimer=setTimeout(()=>renderPage().then(()=>{
      const input=document.querySelector('#searchInput');
      input?.focus();
      input?.setSelectionRange(position,position);
    }),180);
  }
});
app.addEventListener('change',event=>{
  if(event.target.id==='restoreFile')restoreBackup(event.target.files?.[0]);
  if(event.target.id==='voiceLanguage') {
    state.voiceLanguage=event.target.value;
    localStorage.setItem('mdwelders.voiceLanguage',state.voiceLanguage);
  }
  if(event.target.id==='dateStart'||event.target.id==='dateEnd') {
    state.period='custom';
    state.dateStart=document.querySelector('#dateStart')?.value||dateMonthStart();
    state.dateEnd=document.querySelector('#dateEnd')?.value||today();
    renderPage();
  }
  if(event.target.id==='employeeFilter') {
    const selected=event.target.value;
    document.querySelectorAll('#content tbody tr').forEach(row=>{row.hidden=selected!=='all'&&row.cells[6]?.innerText.trim().toLowerCase()!==selected;});
  }
});
window.addEventListener('online',updateSyncLabel);
window.addEventListener('offline',updateSyncLabel);
window.addEventListener('mdwelders:sync-status',()=>updateSyncLabel());
window.addEventListener('mdwelders:sync-progress',()=>updateSyncLabel());

function activeVoiceLanguage() {
  const selected = document.querySelector('#voiceLanguage')?.value;
  return selected || state.voiceLanguage || 'en-IN';
}

function insertVoiceText(target, transcript) {
  if (!target?.isConnected || !transcript) return;
  const value = target.value || '';
  const start = Number.isInteger(target.selectionStart) ? target.selectionStart : value.length;
  const end = Number.isInteger(target.selectionEnd) ? target.selectionEnd : start;
  const prefix = value.slice(0, start);
  const suffix = value.slice(end);
  const separator = prefix && !/\s$/.test(prefix) ? ' ' : '';
  const inserted = `${separator}${transcript.trim()}`;
  target.value = `${prefix}${inserted}${suffix}`;
  const cursor = prefix.length + inserted.length;
  target.setSelectionRange?.(cursor, cursor);
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
}

function setVoiceCaptureStatus(target, status, interim = '') {
  state.voiceActive = status === 'listening' || status === 'processing';
  const wrapper = target?.closest('.voice-input-wrap');
  const button = wrapper?.querySelector('.voice-input-button');
  const statusLabel = wrapper?.querySelector('.voice-input-status');
  button?.classList.toggle('listening', state.voiceActive);
  button?.setAttribute('aria-pressed', String(state.voiceActive));
  if (button) button.title = state.voiceActive ? 'Stop voice typing' : 'Voice type';
  if (statusLabel) {
    statusLabel.textContent = status === 'listening' ? `Listening${interim ? `: ${interim}` : '…'}` : status === 'processing' ? 'Processing speech…' : '';
    statusLabel.classList.toggle('visible', Boolean(statusLabel.textContent));
  }
}

async function captureVoice(target) {
  if (!target) return;
  if (isVoiceInputActive() && state.voiceTarget === target) {
    await stopVoiceInput();
    return;
  }
  state.voiceTarget = target;
  setVoiceCaptureStatus(target, 'listening');
  await startVoiceRecognition({
    language: activeVoiceLanguage(),
    onResult: transcript => {
      insertVoiceText(target, transcript);
      if (target.id === 'assistantText') {
        sendAssistantMessage().catch(error => notify(error.message || 'The assistant could not prepare a transaction draft.', true));
      } else {
        notify('Speech added to the field. Review it before saving.');
      }
    },
    onPartial: transcript => setVoiceCaptureStatus(target, 'listening', transcript),
    onStatus: status => setVoiceCaptureStatus(target, status),
    onError: message => {
      setVoiceCaptureStatus(target, 'idle');
      notify(message, true);
    }
  });
}

function speak(text, language = 'en-IN') {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    notify('Text-to-speech is not available on this device.', true);
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language;
  utterance.onerror = () => notify('The device could not read this response aloud.', true);
  window.speechSynthesis.speak(utterance);
}

async function resizePhoto(file) {
  if (!file) return null;
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file for the employee photo.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Employee photo must be smaller than 5 MB.');
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the selected photo.'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const picture = new Image();
    picture.onload = () => resolve(picture);
    picture.onerror = () => reject(new Error('The selected photo could not be decoded.'));
    picture.src = source;
  });
  const scale = Math.min(1, 512 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.75);
}

async function bootstrap() {
  await initializeDatabase();
  shell();
  await startAutomaticSync();
  if ('serviceWorker' in navigator && !Capacitor.isNativePlatform()) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(error => console.error('Offline app-shell caching could not be enabled.', error));
  }
}

bootstrap().catch(error => {
  console.error('MD Welders could not open its local business database.', error);
  app.innerHTML = `<main class="content"><section class="panel"><div class="eyebrow">LOCAL DATA IS SAFE</div><h1>Could not open your local business database</h1><p class="subtitle">${escapeHtml(error.message)}</p><button class="button button-primary" id="retryStartup">Try again</button></section></main>`;
  document.querySelector('#retryStartup')?.addEventListener('click', () => location.reload());
});
