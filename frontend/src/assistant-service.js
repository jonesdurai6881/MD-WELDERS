import { repository } from './database.js';
import {
  customerBalances, dashboardData, financialSummary, makeAssistantDraft,
  reportDate, salaryBalances, stockBalances
} from './business.js';
import { assistantDateRange } from './assistant.js';
import { syncStatus } from './sync.js';

const domainAliases = {
  dashboard: ['dashboard', 'overview', 'overall business', 'business status', 'workshop'],
  employees: ['employee', 'worker', 'staff', 'team member', 'personnel', 'ஊழியர்', 'பணியாளர்', 'தொழிலாளர்', 'வேலைக்காரர்', 'velaiyal', 'thozhilalar'],
  salary: ['salary', 'wage', 'payroll', 'sambalam', 'kooli', 'சம்பளம்', 'ஊதியம்', 'கூலி'],
  materials: ['material', 'stock', 'inventory', 'raw material', 'porul', 'porutkal', 'saraku', 'iruppu', 'பொருள்', 'மூலப்பொருள்', 'சரக்கு', 'இருப்பு', 'ஸ்டாக்'],
  expenses: ['expense', 'spend', 'cost', 'selavu', 'செலவு', 'செலவுகள்'],
  income: ['income', 'revenue', 'collection', 'received', 'varavu', 'வருமானம்', 'வரவு', 'வசூல்'],
  profit: ['profit', 'net profit', 'laabam', 'லாபம்', 'இலாபம்'],
  customers: ['customer', 'client', 'bill', 'வாடிக்கையாளர்', 'கஸ்டமர்', 'vaadikkaiyalar'],
  projects: ['project', 'work order', 'job', 'assignment', 'crew', 'வேலை', 'பணி', 'திட்டம்', 'thittam', 'vela'],
  reports: ['report', 'analytics', 'cash flow', 'அறிக்கை'],
  sync: ['sync', 'synchronization', 'cloud status', 'connectivity'],
  backup: ['backup', 'restore', 'பேக்கப்'],
  settings: ['settings', 'preferences', 'configuration'],
  notifications: ['notification', 'alert', 'reminder', 'அறிவிப்பு'],
  activity: ['activity log', 'audit log', 'change history', 'வரலாறு'],
  security: ['security', 'password', 'token', 'secret', 'api key', 'credential', 'authentication']
};

const routes = {
  dashboard: 'Dashboard',
  employees: 'Employees',
  salary: 'Salary',
  materials: 'Materials',
  expenses: 'Income',
  income: 'Income',
  profit: 'Income detector',
  customers: 'Customers',
  projects: 'Work',
  reports: 'Reports',
  sync: 'Settings',
  backup: 'Backup',
  settings: 'Settings'
};

export const ASSISTANT_CAPABILITIES = Object.freeze({
  provider: Object.freeze({ type: 'local-rule-based', externalApiConfigured: false }),
  modules: Object.freeze([
    { domain: 'dashboard', route: 'Dashboard', data: ['employees', 'workOrders', 'assignments', 'stockTransactions', 'customerPayments', 'expenses', 'salaryPayments'], operations: ['summary'] },
    { domain: 'employees', route: 'Employees', data: ['employees'], operations: ['count', 'list', 'status'] },
    { domain: 'salary', route: 'Salary', data: ['salaryPayments', 'assignments', 'workOrders', 'employees'], operations: ['pending', 'history', 'summary'] },
    { domain: 'materials', route: 'Materials', data: ['materials', 'stockTransactions'], operations: ['stock', 'low-stock', 'purchase-history', 'purchase-expense'] },
    { domain: 'expenses', route: 'Income', data: ['expenses', 'salaryPayments', 'stockTransactions'], operations: ['summary', 'history', 'category-breakdown'] },
    { domain: 'income', route: 'Income', data: ['customerPayments', 'bills', 'customers'], operations: ['received', 'history'] },
    { domain: 'profit', route: 'Income detector', data: ['customerPayments', 'expenses', 'salaryPayments', 'stockTransactions'], operations: ['period-summary'] },
    { domain: 'customers', route: 'Customers', data: ['customers', 'bills', 'customerPayments'], operations: ['list', 'balances', 'pending'] },
    { domain: 'projects', route: 'Work', data: ['workOrders', 'assignments', 'employees', 'customers'], operations: ['list', 'status', 'assignments'] },
    { domain: 'reports', route: 'Reports', data: ['business records'], operations: ['period-summary'] },
    { domain: 'sync', route: 'Settings', data: ['local sync queue', 'sync status'], operations: ['status'] },
    { domain: 'backup', route: 'Backup', data: [], operations: ['navigate'] },
    { domain: 'settings', route: 'Settings', data: ['sync status'], operations: ['safe-status', 'navigate'] },
    { domain: 'security', route: 'Settings', data: ['safe security notes'], operations: ['safe-status'], excludes: ['passwords', 'tokens', 'secret configuration'] },
    { domain: 'notifications', route: null, data: [], operations: [], available: false, reason: 'No notification repository or screen exists.' },
    { domain: 'activity', route: null, data: [], operations: [], available: false, reason: 'Audit rows are written by backend sync, but there is no audit-read API or local activity store.' }
  ])
});

const unsupportedDomains = new Set(['notifications', 'activity']);
const englishStopWords = new Set(['a', 'an', 'the', 'do', 'does', 'did', 'we', 'our', 'us', 'is', 'are', 'was', 'were', 'have', 'has', 'had', 'to', 'for', 'in', 'on', 'at', 'of', 'and', 'me', 'my', 'this', 'that', 'these', 'those', 'it', 'their', 'them', 'with', 'from', 'by', 'please', 'can', 'you', 'what', 'which', 'who', 'how', 'much', 'many', 'show', 'list', 'tell', 'give']);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{M}\p{N}\s:/.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemEnglish(token) {
  if (!/^[a-z]+$/.test(token)) return token;
  return token.replace(/ies$/, 'y').replace(/s$/, '');
}

function oneEditAway(left, right) {
  if (!/^[a-z]+$/.test(left) || !/^[a-z]+$/.test(right) || Math.abs(left.length - right.length) > 1) return false;
  if (left.length === right.length) {
    const differences = [];
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) differences.push(index);
    }
    if (differences.length === 1) return true;
    return differences.length === 2 &&
      differences[1] === differences[0] + 1 &&
      left[differences[0]] === right[differences[1]] &&
      left[differences[1]] === right[differences[0]];
  }
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
    } else if (skipped) {
      return false;
    } else {
      skipped = true;
      longIndex += 1;
    }
  }
  return true;
}

function tokenMatches(token, alias) {
  const normalizedToken = normalizeText(token);
  const normalizedAlias = normalizeText(alias);
  if (!normalizedToken || !normalizedAlias) return false;
  if (normalizedToken === normalizedAlias || stemEnglish(normalizedToken) === stemEnglish(normalizedAlias)) return true;
  if (/[\u0b80-\u0bff]/u.test(normalizedAlias)) return normalizedToken.startsWith(normalizedAlias);
  return normalizedAlias.length >= 5 && oneEditAway(normalizedToken, normalizedAlias);
}

function aliasScore(normalized, tokens, alias) {
  const normalizedAlias = normalizeText(alias);
  if (!normalizedAlias) return 0;
  if (normalized.includes(normalizedAlias)) return normalizedAlias.includes(' ') ? 4 : 3;
  const aliasTokens = normalizedAlias.split(' ');
  if (aliasTokens.length > 1) {
    return aliasTokens.every(part => tokens.some(token => tokenMatches(token, part))) ? 2 : 0;
  }
  if (tokens.some(token => tokenMatches(token, normalizedAlias))) return 1;
  return 0;
}

function scoreAliases(normalized, tokens, aliases) {
  return aliases.reduce((score, alias) => score + aliasScore(normalized, tokens, alias), 0);
}

function hasFollowUpReference(normalized) {
  return /(?:\b(?:their|them|those|these|it|that|ones?|what about|and then)\b|அவர்கள்|அவற்றை|அதில்|அதற்கு)/u.test(normalized);
}

function hasAlias(normalized, aliases) {
  const tokens = normalized.split(' ').filter(Boolean);
  return aliases.some(alias => aliasScore(normalized, tokens, alias) > 0);
}

function hasLiteralAlias(normalized, aliases) {
  const tokens = normalized.split(' ').filter(Boolean);
  return aliases.some(alias => {
    const aliasTokens = normalizeText(alias).split(' ').filter(Boolean);
    return aliasTokens.length > 1
      ? aliasTokens.every(part => tokens.some(token => token === part || stemEnglish(token) === stemEnglish(part)))
      : tokens.some(token => token === aliasTokens[0] || stemEnglish(token) === stemEnglish(aliasTokens[0]));
  });
}

const countAliases = ['how many', 'count', 'number of', 'total number', 'total employees', 'total employee', 'total workers', 'employee total', 'worker total', 'staff total', 'எத்தனை', 'எண்ணிக்கை', 'ethana', 'ethanai', 'eththanai'];
const pendingAliases = ['pending', 'due', 'unpaid', 'outstanding', 'owe', 'owes', 'owed', 'balance due', 'பாக்கி', 'நிலுவை', 'கடன்', 'கொடுக்க வேண்டும்', 'கொடுக்கணும்', 'kudukka vendum', 'yaaruku'];
const listAliases = ['show', 'list', 'names', 'all', 'who', 'which', 'display', 'என்னென்ன', 'யார்', 'பெயர்', 'பேர்', 'kaatu', 'sollu', 'enna'];
const historyAliases = ['history', 'recent', 'past', 'transactions', 'payment history', 'வரலாறு', 'பரிவர்த்தனை'];
const stockAliases = ['stock', 'inventory', 'available', 'in hand', 'on hand', 'left', 'irukku', 'இருப்பு', 'கையிருப்பு'];
const spendAliases = ['spent', 'spend', 'purchase', 'purchases', 'bought', 'cost', 'selavu', 'செலவு', 'கொள்முதல்', 'வாங்கின'];
const writeAliases = ['add', 'create', 'record', 'save', 'update', 'edit', 'delete', 'remove', 'சேர்', 'உருவாக்கு', 'பதிவு செய்'];
const transactionStatementAliases = ['paid', 'pay', 'spent', 'received', 'bought', 'purchase', 'kuduthen', 'koduthen', 'selavu', 'vaanginen', 'vanginen', 'கொடுத்தேன்', 'குடுத்தேன்', 'வாங்கினேன்', 'செலவு செய்தேன்'];

function inferDomain(normalized, previousContext) {
  const tokens = normalized.split(' ').filter(token => token && !englishStopWords.has(token));
  const scores = Object.entries(domainAliases)
    .map(([domain, aliases]) => [domain, scoreAliases(normalized, tokens, aliases)])
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1]);
  const has = aliases => hasAlias(normalized, aliases);
  const pending = has(pendingAliases);
  const people = has(domainAliases.employees);
  const materials = has(domainAliases.materials);
  const projects = has(domainAliases.projects);
  const explicitProject = /\b(?:project|work order|job|assignment)\b|திட்டம்|thittam/u.test(normalized);
  const employeeWords = /\b(?:employees?|workers?|staff|team members?|labou?rer?s?)\b|ஊழியர்|பணியாளர்|தொழிலாளர/u.test(normalized);
  const salaryWords = /\b(?:salary|wage|payroll)\b|சம்பளம்|ஊதியம்|கூலி/u.test(normalized);
  const explicitCount = /\bhow many\b|\b(?:count|number of|total number|total employees?|total workers?|employee total|worker total|staff total)\b|எத்தனை|எண்ணிக்கை|ethana|ethanai|eththanai/u.test(normalized);

  if (has(['password', 'token', 'secret', 'api key', 'credential', 'கடவுச்சொல்'])) return 'security';
  if (has(domainAliases.profit)) return 'profit';
  if (has(domainAliases.salary)) return 'salary';
  if (employeeWords && explicitCount && !salaryWords && !explicitProject) return 'employees';
  if (pending && has(['payment', 'payments', 'bill', 'bills', 'customer', 'customers', 'owe', 'owes', 'owed'])) return 'customers';
  if (projects && people) return 'projects';
  if (materials && has(spendAliases)) return 'materials';
  if (has(['owe us', 'owes us', 'who owes', 'outstanding customer', 'customer due', 'வாடிக்கையாளர் பாக்கி'])) return 'customers';
  if (scores.length) return scores[0][0];

  const followUp = hasFollowUpReference(normalized)
    || has(['last month', 'this month', 'இன்று', 'இந்த மாதம்', 'இந்த ஆண்டு', 'what about']);
  return followUp ? previousContext?.tool || '' : '';
}

function parsePeriod(normalized, rawText, fallback = 'today') {
  const dates = [...String(rawText).matchAll(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/g)].map(match => match[1]);
  const toIso = value => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const [day, month, year] = value.split(/[/-]/).map(Number);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  if (dates.length >= 2) {
    const start = toIso(dates[0]);
    const end = toIso(dates[1]);
    if (start && end && start <= end) return { code: 'custom', start, end, label: `${start} to ${end}` };
    return null;
  }
  if (dates.length === 1) {
    const date = toIso(dates[0]);
    return date ? { code: 'custom', start: date, end: date, label: date } : null;
  }
  if (hasLiteralAlias(normalized, ['all time', 'all-time', 'overall', 'since beginning', 'all records', 'மொத்தமாக இதுவரை'])) {
    return { code: 'all', start: '0000-01-01', end: '9999-12-31', label: 'all recorded dates' };
  }
  if (hasLiteralAlias(normalized, ['yesterday', 'நேற்று', 'nethu'])) {
    const date = new Date(`${reportDate()}T00:00:00`);
    date.setDate(date.getDate() - 1);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { code: 'yesterday', start: day, end: day, label: 'yesterday' };
  }
  let period = fallback;
  if (hasLiteralAlias(normalized, ['this year', 'yearly', 'annual', 'இந்த ஆண்டு', 'இந்த வருடம்', 'இந்த வருஷம்', 'indha varusham'])) period = 'year';
  else if (hasLiteralAlias(normalized, ['last month', 'கடந்த மாதம்', 'pona masam'])) period = 'lastMonth';
  else if (hasLiteralAlias(normalized, ['this month', 'monthly', 'இந்த மாதம்', 'இந்த மாசம்', 'indha month', 'indha masam'])) period = 'month';
  else if (hasLiteralAlias(normalized, ['today', 'daily', 'இன்று', 'இன்னைக்கு', 'innaiku'])) period = 'today';
  const range = assistantDateRange(period, reportDate());
  return { ...range, code: period };
}

function inferOperation(normalized, previousContext, rawText) {
  const has = aliases => hasAlias(normalized, aliases);
  if (has(pendingAliases)) return 'pending';
  if (has(countAliases)) return 'count';
  if (has(stockAliases)) return 'stock';
  if (has(historyAliases)) return 'history';
  if (has(listAliases)) return 'list';
  if (has(['how much', 'total', 'amount', 'sum', 'evlo', 'எவ்வளவு', 'மொத்த', 'வருமானம்', 'லாபம்'])) return 'summary';
  if (has(writeAliases)) return 'write';
  if (!isQuestion(normalized, rawText) && /\d/.test(rawText) && has(transactionStatementAliases)) return 'write';
  return previousContext?.operation || 'summary';
}

function isNavigationRequest(normalized) {
  return /\b(?:open|go to|navigate to|take me to|switch to|open page|show page|show screen)\b|திற|செல்|போக|poga/u.test(normalized);
}

function isQuestion(normalized, rawText) {
  return String(rawText).includes('?') ||
    /^(how|what|who|which|where|when|show|list|tell|display|find|give|can|do we|is there|are there)\b/i.test(normalized) ||
    /(?:என்ன|எவ்வளவு|எத்தனை|யார்|இருக்கிறதா|உண்டா|எப்படி)/u.test(normalized);
}

export function parseAssistantRequest(text, previousContext = null) {
  const rawText = String(text || '').normalize('NFKC').trim();
  const normalized = normalizeText(rawText);
  if (!normalized) return { type: 'clarify', reason: 'empty' };
  if (hasAlias(normalized, ['what can you do', 'help', 'உதவி', 'என்ன செய்ய முடியும்'])) return { type: 'help' };

  const domain = inferDomain(normalized, previousContext);
  const period = parsePeriod(normalized, rawText, previousContext?.period || 'today');
  if (!period) return { type: 'clarify', reason: 'date-range' };
  const operation = inferOperation(normalized, previousContext, rawText);
  if (isNavigationRequest(normalized)) {
    if (unsupportedDomains.has(domain)) return { type: 'unsupported', domain };
    return routes[domain]
      ? { type: 'navigate', domain, route: routes[domain] }
      : { type: 'clarify', reason: 'navigation-target' };
  }
  if (!domain) return { type: 'clarify', reason: 'unknown-domain' };
  if (unsupportedDomains.has(domain)) return { type: 'unsupported', domain };
  if (domain === 'security') return { type: 'security', operation };
  if (operation === 'write') return { type: 'write', domain, route: routes[domain] || '' };
  return {
    type: 'query',
    tool: domain,
    operation,
    period: period.code,
    range: { start: period.start, end: period.end, label: period.label },
    question: isQuestion(normalized, rawText)
  };
}

export const ASSISTANT_TOOLS = Object.freeze(Object.keys(routes));

function formatMoney(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
}

function sum(rows, select = row => row.amount) {
  return Math.round((rows.reduce((total, row) => total + Number(select(row) || 0), 0) + Number.EPSILON) * 100) / 100;
}

function dateInRange(value, range) {
  const date = String(value || '').slice(0, 10);
  return date >= range.start && date <= range.end;
}

function periodLabel(request) {
  return request.range?.label ? ` for ${request.range.label}` : '';
}

async function localSourceNote() {
  const status = await syncStatus();
  if (!status.online) return 'Offline: using records saved on this device; newer cloud changes may not be available.';
  if (!status.configured) return 'Using records saved on this device; cloud sync is not configured.';
  if (status.pending || status.failed || status.conflicts) {
    return `Using records saved on this device; sync queue has ${status.pending} pending, ${status.failed} failed, and ${status.conflicts} conflicted changes.`;
  }
  if (status.lastSyncAt) return `Using records saved on this device; last successful sync was ${new Date(status.lastSyncAt).toLocaleString()}.`;
  return 'Using records saved on this device; no successful cloud sync is recorded.';
}

function withSource(response, note) {
  return `${response}\n${note}`;
}

async function answerEmployees(request) {
  let employees = await repository().list('employees');
  const normalized = normalizeText(request.text);
  if (hasAlias(normalized, ['active', 'செயலில்'])) employees = employees.filter(item => item.isActive !== false);
  if (hasAlias(normalized, ['inactive', 'former', 'செயலில் இல்லை'])) employees = employees.filter(item => item.isActive === false);
  if (request.entityId) employees = employees.filter(item => item.id === request.entityId);
  if (request.operation === 'count') {
    const label = hasAlias(normalized, ['active', 'செயலில்']) ? ' active' : '';
    return { response: employees.length ? `There ${employees.length === 1 ? 'is' : 'are'} ${employees.length}${label} registered employee${employees.length === 1 ? '' : 's'} in the saved records.` : `No${label} employees are registered in the saved records.` };
  }
  if (!employees.length) return { response: 'No registered employees were found in the saved records.' };
  const lines = employees.slice(0, 20).map(employee => `${employee.fullName}${employee.role ? ` — ${employee.role}` : ''}${employee.isActive === false ? ' (inactive)' : ''}`);
  const more = employees.length > lines.length ? `\nShowing ${lines.length} of ${employees.length} employees.` : '';
  return { response: `Registered employees:\n${lines.join('\n')}${more}` };
}

async function answerSalary(request) {
  const balances = await salaryBalances();
  const selected = request.entityId ? balances.filter(item => item.employee.id === request.entityId) : balances;
  if (request.operation === 'pending') {
    const due = selected.filter(item => item.pending > 0);
    if (!due.length) return { response: 'No pending salary is recorded for the selected employees.' };
    return { response: `Pending salary:\n${due.slice(0, 20).map(item => `${item.employee.fullName}: ${formatMoney(item.pending)}`).join('\n')}` };
  }
  if (request.operation === 'history') {
    const employees = new Map(balances.map(item => [item.employee.id, item.employee.fullName]));
    const payments = (await repository().list('salaryPayments'))
      .filter(item => dateInRange(item.paidAt, request.range) && (!request.entityId || item.employeeId === request.entityId))
      .sort((left, right) => String(right.paidAt).localeCompare(String(left.paidAt)));
    if (!payments.length) return { response: `No salary payments were recorded${periodLabel(request)}.` };
    return { response: `Salary payments${periodLabel(request)} total ${formatMoney(sum(payments))}:\n${payments.slice(0, 12).map(item => `${item.paidAt}: ${employees.get(item.employeeId) || 'Former employee'} — ${formatMoney(item.amount)}`).join('\n')}` };
  }
  const payments = (await repository().list('salaryPayments'))
    .filter(item => dateInRange(item.paidAt, request.range) && (!request.entityId || item.employeeId === request.entityId));
  return { response: `Salary paid${periodLabel(request)}: ${formatMoney(sum(payments))} across ${payments.length} payment${payments.length === 1 ? '' : 's'}.` };
}

async function answerMaterials(request) {
  const balances = await stockBalances();
  const materialName = new Map(balances.map(item => [item.material.id, item.material.name]));
  const normalized = normalizeText(request.text);
  const purchaseQuestion = request.operation === 'history' ||
    hasAlias(normalized, spendAliases) ||
    hasAlias(normalized, ['purchase expense', 'purchase cost', 'purchase history', 'material purchases']);
  if (purchaseQuestion) {
    const summary = await financialSummary(request.range.start, request.range.end);
    const purchases = summary.expenseRows
      .filter(item => item.source === 'Stock purchase' && (!request.entityId || item.materialId === request.entityId));
    if (!purchases.length) return { response: `No material purchases were recorded${periodLabel(request)}.` };
    const groups = new Map();
    for (const purchase of purchases) {
      const current = groups.get(purchase.materialId) || { name: materialName.get(purchase.materialId) || 'Unknown material', amount: 0, quantity: 0, unit: '' };
      current.amount += Number(purchase.amount || 0);
      current.quantity += Number(purchase.quantity || 0);
      current.unit = purchase.unit || current.unit;
      groups.set(purchase.materialId, current);
    }
    const breakdown = [...groups.values()].map(item =>
      `${item.name}: ${formatMoney(item.amount)}${item.quantity ? ` (${item.quantity}${item.unit ? ` ${item.unit}` : ''})` : ''}`
    );
    return { response: `Material purchase expenses${periodLabel(request)} total ${formatMoney(sum(purchases))}:\n${breakdown.join('\n')}` };
  }

  let items = balances;
  if (request.entityId) items = items.filter(item => item.material.id === request.entityId);
  if (hasAlias(normalized, ['low stock', 'running low', 'குறைந்த இருப்பு'])) {
    items = items.filter(item => item.available <= Number(item.material.lowStockThreshold || 0));
  }
  if (!items.length) return { response: 'No matching materials or stock records were found.' };
  const lines = items.slice(0, 20).map(item =>
    `${item.material.name}: ${item.available} ${item.material.unit}${item.available <= Number(item.material.lowStockThreshold || 0) ? ' (low stock)' : ''}`
  );
  const more = items.length > lines.length ? `\nShowing ${lines.length} of ${items.length} materials.` : '';
  return { response: `Current material stock:\n${lines.join('\n')}${more}` };
}

async function answerFinancial(request) {
  const summary = await financialSummary(request.range.start, request.range.end);
  const suffix = periodLabel(request);
  if (request.tool === 'profit') return { response: `Business profit${suffix}: ${formatMoney(summary.profit)}. Received income ${formatMoney(summary.received)} minus recorded expenses ${formatMoney(summary.expenses)}.` };
  if (request.tool === 'income') {
    if (request.operation === 'history' || request.operation === 'list') {
      const customers = new Map((await repository().list('customers')).map(item => [item.id, item.fullName]));
      const payments = summary.incomeRows.sort((left, right) => String(right.receivedAt).localeCompare(String(left.receivedAt)));
      if (!payments.length) return { response: `No customer payments were received${suffix}.` };
      return { response: `Received customer payments${suffix} total ${formatMoney(summary.received)}:\n${payments.slice(0, 12).map(item => `${item.receivedAt}: ${customers.get(item.customerId) || 'Customer'} — ${formatMoney(item.amount)}`).join('\n')}` };
    }
    return { response: `Income actually received${suffix}: ${formatMoney(summary.received)}. Unpaid bills are not counted as income.` };
  }
  const rows = summary.expenseRows;
  if (request.operation === 'history' || request.operation === 'list') {
    if (!rows.length) return { response: `No expenses were recorded${suffix}.` };
    return { response: `Recorded expenses${suffix} total ${formatMoney(summary.expenses)}:\n${rows.slice(0, 12).map(item => `${item.incurredAt}: ${item.source || item.category || item.description} — ${formatMoney(item.amount)}`).join('\n')}` };
  }
  const bySource = new Map();
  for (const row of rows) {
    const label = row.source || row.category || 'Expense';
    bySource.set(label, (bySource.get(label) || 0) + Number(row.amount || 0));
  }
  const breakdown = [...bySource.entries()].map(([label, amount]) => `${label}: ${formatMoney(amount)}`);
  return { response: `Recorded expenses${suffix}: ${formatMoney(summary.expenses)}${breakdown.length ? `\n${breakdown.join('\n')}` : ''}.` };
}

async function answerCustomers(request) {
  let balances = await customerBalances();
  if (request.entityId) balances = balances.filter(item => item.customer.id === request.entityId);
  if (request.operation === 'list') {
    if (!balances.length) return { response: 'No customer records were found.' };
    return { response: `Registered customers:\n${balances.slice(0, 20).map(item => item.customer.fullName).join('\n')}` };
  }
  if (request.operation === 'pending') {
    const due = balances.filter(item => item.pending > 0);
    if (!due.length) return { response: 'No customers have an outstanding balance in the saved records.' };
    return { response: `Customers with outstanding balances:\n${due.slice(0, 20).map(item => `${item.customer.fullName}: ${formatMoney(item.pending)}`).join('\n')}` };
  }
  if (request.operation === 'history') {
    const customers = new Map(balances.map(item => [item.customer.id, item.customer.fullName]));
    const payments = (await repository().list('customerPayments'))
      .filter(item => dateInRange(item.receivedAt, request.range) && (!request.entityId || item.customerId === request.entityId))
      .sort((left, right) => String(right.receivedAt).localeCompare(String(left.receivedAt)));
    if (!payments.length) return { response: `No customer payments were received${periodLabel(request)}.` };
    return { response: `Customer payments${periodLabel(request)} total ${formatMoney(sum(payments))}:\n${payments.slice(0, 12).map(item => `${item.receivedAt}: ${customers.get(item.customerId) || 'Customer'} — ${formatMoney(item.amount)}`).join('\n')}` };
  }
  if (!balances.length) return { response: 'No customer records were found.' };
  return { response: `Customer balances:\n${balances.slice(0, 20).map(item => `${item.customer.fullName}: billed ${formatMoney(item.billed)}, received ${formatMoney(item.paid)}, outstanding ${formatMoney(item.pending)}`).join('\n')}` };
}

async function answerProjects(request) {
  const [orders, assignments, employees, customers] = await Promise.all([
    repository().list('workOrders'), repository().list('assignments'),
    repository().list('employees'), repository().list('customers')
  ]);
  const normalized = normalizeText(request.text);
  let selected = orders;
  if (request.entityId) selected = selected.filter(order => order.id === request.entityId);
  else if (hasAlias(normalized, ['ongoing', 'in progress', 'active', 'currently working', 'நடந்து கொண்டிருக்கும்', 'தொடரும்'])) {
    selected = selected.filter(order => ['PENDING', 'IN_PROGRESS'].includes(order.status));
  } else if (hasAlias(normalized, ['completed', 'finished', 'முடிந்த'])) {
    selected = selected.filter(order => order.status === 'COMPLETED');
  } else if (hasAlias(normalized, ['cancelled', 'canceled', 'ரத்து'])) {
    selected = selected.filter(order => order.status === 'CANCELLED');
  } else if (!hasAlias(normalized, ['all projects', 'all work orders', 'எல்லா வேலைகள்'])) {
    selected = selected.filter(order => order.status !== 'CANCELLED');
  }
  const namedOrder = selected.find(order => normalizeText(order.title) && normalized.includes(normalizeText(order.title)));
  if (namedOrder) selected = [namedOrder];
  if (!selected.length) return { response: 'No matching projects or work orders were found in the saved records.' };
  const employeeNames = new Map(employees.map(item => [item.id, item.fullName]));
  const customerNames = new Map(customers.map(item => [item.id, item.fullName]));
  const lines = selected.slice(0, 20).map(order => {
    const team = assignments.filter(item => item.workOrderId === order.id)
      .map(item => employeeNames.get(item.employeeId))
      .filter(Boolean);
    const customer = customerNames.get(order.customerId);
    return `${order.title} (${String(order.status || 'unknown').replaceAll('_', ' ').toLowerCase()}, ${order.workDate})${customer ? ` — ${customer}` : ''}: ${team.length ? team.join(', ') : 'no workers assigned'}`;
  });
  return {
    response: `Saved projects and work orders:\n${lines.join('\n')}`,
    ...(selected.length === 1 ? { selectedEntityId: selected[0].id } : {})
  };
}

async function answerDashboard(request) {
  const [data, summary, balances, customers, stock] = await Promise.all([
    dashboardData(),
    financialSummary(request.range.start, request.range.end),
    salaryBalances(),
    customerBalances(),
    stockBalances()
  ]);
  const pendingSalary = balances.filter(item => item.pending > 0).length;
  const pendingCustomers = customers.filter(item => item.pending > 0).length;
  const lowStock = stock.filter(item => item.available <= Number(item.material.lowStockThreshold || 0)).length;
  return {
    response: `Business overview${periodLabel(request)}:\n${data.employeeCount} employees; ${data.activeJobs} active projects; ${data.todayJobs} jobs scheduled today.\nIncome received ${formatMoney(summary.received)}; expenses ${formatMoney(summary.expenses)}; profit ${formatMoney(summary.profit)}.\n${pendingSalary} employees with pending salary; ${pendingCustomers} customers with outstanding balances; ${lowStock} low-stock materials.`
  };
}

async function answerReports(request) {
  const [summary, employees, customers, stock] = await Promise.all([
    financialSummary(request.range.start, request.range.end),
    salaryBalances(), customerBalances(), stockBalances()
  ]);
  const pendingSalary = sum(employees, item => item.pending);
  const pendingCustomer = sum(customers, item => item.pending);
  const lowStock = stock.filter(item => item.available <= Number(item.material.lowStockThreshold || 0)).length;
  return {
    response: `Business report${periodLabel(request)}:\nIncome ${formatMoney(summary.received)}; expenses ${formatMoney(summary.expenses)}; profit ${formatMoney(summary.profit)}.\nOutstanding customer balances ${formatMoney(pendingCustomer)}; unpaid assigned salary ${formatMoney(pendingSalary)}; low-stock materials ${lowStock}.`
  };
}

async function answerSync() {
  const status = await syncStatus();
  return {
    response: `Sync status: ${status.status}. ${status.pending} pending, ${status.failed} failed, ${status.conflicts} conflicts. ${status.configured ? 'A sync endpoint is configured.' : 'Cloud sync is not configured.'} The assistant reads local records; synchronized changes are available here after they have been applied to this device.`
  };
}

const toolRegistry = Object.freeze({
  dashboard: answerDashboard,
  employees: answerEmployees,
  salary: answerSalary,
  materials: answerMaterials,
  expenses: answerFinancial,
  income: answerFinancial,
  profit: answerFinancial,
  customers: answerCustomers,
  projects: answerProjects,
  reports: answerReports,
  sync: answerSync,
  settings: answerSync
});

function previousAssistantContext(conversation) {
  return [...conversation].reverse().find(message => message.role === 'assistant' && message.context)?.context || null;
}

async function findSavedEntity(text) {
  const normalized = normalizeText(text);
  const [employees, customers, materials, projects] = await Promise.all([
    repository().list('employees'),
    repository().list('customers'),
    repository().list('materials'),
    repository().list('workOrders')
  ]);
  const candidates = [
    ...materials.map(item => ({ domain: 'materials', id: item.id, name: item.name })),
    ...employees.map(item => ({ domain: 'employees', id: item.id, name: item.fullName })),
    ...customers.map(item => ({ domain: 'customers', id: item.id, name: item.fullName })),
    ...projects.map(item => ({ domain: 'projects', id: item.id, name: item.title }))
  ].filter(item => item.name && normalizeText(item.name).length >= 3)
    .sort((left, right) => normalizeText(right.name).length - normalizeText(left.name).length);
  return candidates.find(item => normalized.includes(normalizeText(item.name))) || null;
}

function safeSecurityResponse(request) {
  const normalized = normalizeText(request.text);
  if (hasAlias(normalized, ['password', 'token', 'secret', 'api key', 'credential', 'கடவுச்சொல்'])) {
    return 'I cannot reveal passwords, authentication tokens, API keys, or secret configuration. The assistant does not read those values.';
  }
  return 'This app has no per-user role model for assistant queries. The assistant is limited to business records already available in this local app; sync authentication is separate, and secret credentials are not exposed.';
}

function helpResponse() {
  const modules = ASSISTANT_CAPABILITIES.modules.filter(item => item.available !== false).map(item => item.route).filter((route, index, list) => route && list.indexOf(route) === index);
  return `I use a local rule-based assistant; no external AI API is configured. I can answer from saved records for ${modules.join(', ')} and navigate to those screens. Notifications and activity-log queries are unavailable because this app has no corresponding local data source or read API.`;
}

function clarifyResponse(request) {
  if (request.reason === 'date-range') return 'I could not interpret that date range. Please use dates such as “from 2026-10-01 to 2026-10-31”.';
  if (request.reason === 'navigation-target') return 'Which existing app screen should I open? I can navigate to Dashboard, Employees, Work, Salary, Materials, Customers, Income, Income detector, Reports, Backup, or Settings.';
  return 'I could not match that request to saved business information. Try asking about employees, salary, materials or stock, purchases, expenses, income, profit, customers, projects, reports, or sync status. I will not invent an answer.';
}

function contextFor(request, selectedEntityId) {
  return {
    tool: request.tool,
    operation: request.operation,
    period: request.period,
    ...(request.entityId || selectedEntityId ? { entityId: request.entityId || selectedEntityId } : {})
  };
}

export async function answerAssistant(text, conversation = []) {
  const rawText = String(text || '').trim();
  if (!rawText) throw new Error('Type or say a question first.');
  const previousContext = previousAssistantContext(conversation);
  let request = parseAssistantRequest(rawText, previousContext);

  if (request.type === 'clarify' && request.reason === 'unknown-domain') {
    const entity = await findSavedEntity(rawText);
    if (entity) {
      request = {
        type: 'query',
        tool: entity.domain,
        operation: inferOperation(normalizeText(rawText), previousContext, rawText),
        period: parsePeriod(normalizeText(rawText), rawText, previousContext?.period || 'today')?.code || 'today',
        range: parsePeriod(normalizeText(rawText), rawText, previousContext?.period || 'today'),
        entityId: entity.id,
        entityName: entity.name,
        text: rawText
      };
    }
  }

  if (request.type === 'query' && !request.entityId && previousContext?.entityId &&
      previousContext.tool === request.tool && hasFollowUpReference(normalizeText(rawText))) {
    request = { ...request, entityId: previousContext.entityId };
  }

  if (request.type === 'query' || request.type === 'write') request.text = rawText;
  if (request.type === 'navigate') {
    return {
      intent: 'navigation',
      response: `Opening ${request.route}. No business records were changed.`,
      navigateTo: request.route,
      source: 'local',
      context: { tool: request.domain, operation: 'navigate' }
    };
  }
  if (request.type === 'help') return { intent: 'capabilities', response: helpResponse(), source: 'local' };
  if (request.type === 'unsupported') {
    const reason = request.domain === 'notifications'
      ? 'This app has no saved notification or reminder data to query.'
      : 'The backend records sync audit events, but the app has no audit-log read API or local activity store.';
    return { intent: request.domain, response: `${reason} I will not invent those records.`, source: 'local' };
  }
  if (request.type === 'security') {
    return { intent: 'security', response: safeSecurityResponse({ ...request, text: rawText }), source: 'local' };
  }
  if (request.type === 'clarify') {
    return { intent: 'clarification', response: clarifyResponse(request), source: 'local' };
  }
  if (request.type === 'write') {
    if (['salary', 'income', 'expenses'].includes(request.domain) &&
        !isQuestion(normalizeText(rawText), rawText) && /\d/.test(rawText)) {
      try {
        const draft = await makeAssistantDraft(rawText);
        return {
          intent: 'transaction',
          draft,
          response: 'I prepared a transaction proposal from your message. Review the amount, date, and recipient, then confirm to save it. Nothing has been saved yet.',
          source: 'local',
          context: { tool: request.domain, operation: 'draft' }
        };
      } catch (error) {
        if (!/find an amount|identify this as salary/i.test(error.message)) throw error;
      }
    }
    const route = request.route || routes[request.domain];
    return {
      intent: 'navigation',
      response: route
        ? `I cannot change records from chat without a complete reviewable draft. Opening ${route}; use its existing form to review and save explicitly. No records were changed.`
        : 'This write operation is not available in chat. No records were changed.',
      ...(route ? { navigateTo: route } : {}),
      source: 'local',
      context: { tool: request.domain, operation: 'write' }
    };
  }

  const handler = toolRegistry[request.tool];
  if (!handler) return { intent: 'clarification', response: clarifyResponse({ reason: 'unknown-domain' }), source: 'local' };
  const result = await handler(request);
  const note = await localSourceNote();
  const { selectedEntityId, ...answer } = result;
  return {
    ...answer,
    intent: request.tool === 'employees' && request.operation === 'count'
      ? 'employeeCount'
      : request.tool === 'customers' && request.operation === 'pending'
        ? 'pendingPayments'
        : request.tool,
    period: request.period,
    source: 'local',
    response: withSource(answer.response, note),
    context: contextFor(request, selectedEntityId)
  };
}
