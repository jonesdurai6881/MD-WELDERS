function positiveAmount(value) {
  const parsed = Number(String(value).replaceAll(',', ''));
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Enter an amount greater than zero.');
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function assistantDateRange(period, date = localDate()) {
  const [year, month] = date.split('-').map(Number);
  if (period === 'year') return { start: `${year}-01-01`, end: date, label: 'this year' };
  if (period === 'month') return { start: `${year}-${String(month).padStart(2, '0')}-01`, end: date, label: 'this month' };
  if (period === 'lastMonth') {
    const first = new Date(year, month - 2, 1);
    const last = new Date(year, month - 1, 0);
    const format = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    return { start: format(first), end: format(last), label: 'last month' };
  }
  return { start: date, end: date, label: 'today' };
}

export function prepareAssistantDraft(text, date = localDate()) {
  const normalized = text.trim();
  if (!normalized) throw new Error('Type or say what happened first.');
  const amountMatch = normalized.match(/(?:₹|rs\.?\s*)([\d,]+(?:\.\d{1,2})?)/i)
    || normalized.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:rupees?|rs\.?|salary|sambalam|wage|expense|purchase|income|payment|ரூபாய்|சம்பளம்|ஊதியம்|செலவு|வரவு)/i)
    || normalized.match(/(?:paid|pay|received|got|spent|expense|salary|amount|செலுத்தினேன்|கொடுத்தேன்|குடுத்தேன்|கொடுத்தது)\s+(?:of\s+)?(?:₹|rs\.?\s*)?([\d,]+(?:\.\d{1,2})?)/i);
  const matchedAmount = amountMatch?.[1];
  if (!matchedAmount) throw new Error('I could not find an amount. Please describe the transaction with an amount.');
  const amount = positiveAmount(matchedAmount);
  const salary = /\b(salary|wage|sambalam)\b/i.test(normalized) || /ஊதியம்|சம்பளம்/.test(normalized);
  const expense = /\b(expense|spent|purchase|bought|selavu|vaanginen|vaanginom)\b/i.test(normalized) || /செலவு|வாங்கினேன்|வாங்கினோம்/.test(normalized);
  const income = /\b(income|received|got|customer payment|payment received|vasool|varavu)\b/i.test(normalized) || /வரவு|கிடைத்தது|பெற்றேன்|வசூல்/.test(normalized);
  if (!salary && !expense && !income) {
    throw new Error('I could not identify this as salary, a business expense, or received customer income. Add that detail and review again.');
  }
  const countWords = 'one|two|three|four|five|1|2|3|4|5|ஒன்று|இரண்டு|மூன்று|நான்கு|ஐந்து|ஒரு|ரெண்டு|மூணு|நாலு|அஞ்சு';
  const employeeCountMatch = normalized.match(new RegExp(`\\b(${countWords})\\s+employees?\\b`, 'i'))
    || normalized.match(new RegExp(`(${countWords})\\s*(?:employees?|ஊழியர்கள்?|பேருக்கு|பேருக்கு)`, 'i'));
  const employeeCounts = {
    one: 1, two: 2, three: 3, four: 4, five: 5, ஒன்று: 1, இரண்டு: 2, மூன்று: 3, நான்கு: 4, ஐந்து: 5,
    ஒரு: 1, ரெண்டு: 2, மூணு: 3, நாலு: 4, அஞ்சு: 5
  };
  const countToken = employeeCountMatch?.[1]?.toLocaleLowerCase();
  const employeeCount = countToken ? Number(employeeCounts[countToken] || countToken) : 1;
  return {
    type: salary ? 'salary' : expense ? 'expense' : 'income',
    amount,
    employeeCount,
    date,
    description: normalized,
    employeeId: '',
    category: salary ? 'Salary' : expense ? 'General' : 'Customer payment',
    customerId: '',
    note: 'Review and complete missing details before confirmation.'
  };
}
