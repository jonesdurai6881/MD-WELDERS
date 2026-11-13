import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAssistantDraft } from '../frontend/src/assistant.js';
import { parseAssistantRequest } from '../frontend/src/assistant-service.js';

test('employee count intent recognizes English, Tamil, and Tanglish questions', () => {
  const questions = [
    'How many employees are registered?',
    'How many workers do we have?',
    'Total employees?',
    'எத்தனை employees இருக்காங்க?',
    'நம்மிடம் எத்தனை தொழிலாளர்கள் இருக்கிறார்கள்?',
    'Namma kitta ethana workers irukanga?'
  ];
  for (const question of questions) {
    const request = parseAssistantRequest(question);
    assert.equal(request.tool, 'employees', question);
    assert.equal(request.operation, 'count', question);
  }
  const projectQuestion = parseAssistantRequest('How many workers are assigned to this project?');
  assert.equal(projectQuestion.tool, 'projects');
  const salaryQuestion = parseAssistantRequest('Total salary paid to employees?');
  assert.equal(salaryQuestion.tool, 'salary');
  assert.equal(salaryQuestion.type, 'query');
});

test('central request parser recognizes cross-module questions in English, Tamil, and Tanglish', () => {
  const cases = [
    ['Show all employee names', 'employees', 'list'],
    ['Who has pending salary?', 'salary', 'pending'],
    ['How much did we spend on materials this month?', 'materials', 'summary'],
    ['What is today’s profit?', 'profit', 'summary'],
    ['Which customer owes us money?', 'customers', 'pending'],
    ['Show ongoing projects', 'projects', 'list'],
    ['நம்முடைய மொத்த வருமானம் எவ்வளவு?', 'income', 'summary'],
    ['யாருக்கு சம்பளம் கொடுக்க வேண்டும்?', 'salary', 'pending'],
    ['இந்த மாதம் எவ்வளவு செலவு?', 'expenses', 'summary'],
    ['நம்மிடம் என்னென்ன materials stock இருக்கு?', 'materials', 'stock']
  ];
  for (const [question, tool, operation] of cases) {
    const request = parseAssistantRequest(question);
    assert.equal(request.type, 'query', question);
    assert.equal(request.tool, tool, question);
    assert.equal(request.operation, operation, question);
  }
});

test('follow-up requests retain the prior data domain and period', () => {
  const previous = { tool: 'employees', operation: 'count', period: 'month' };
  const request = parseAssistantRequest('Show their names', previous);
  assert.equal(request.tool, 'employees');
  assert.equal(request.operation, 'list');
  assert.equal(request.period, 'month');
});

test('questions about spending stay read-only while transaction statements become drafts', () => {
  const question = parseAssistantRequest('How much did we spend on materials this month?');
  assert.equal(question.type, 'query');
  assert.equal(question.tool, 'materials');
  const statement = parseAssistantRequest('Today I spent 500 rupees on transport');
  assert.equal(statement.type, 'write');
  assert.equal(statement.domain, 'expenses');
});

test('English salary statements prepare editable drafts and extract employee count', () => {
  const draft = prepareAssistantDraft('Today I paid 1800 rupees salary to three employees', '2026-11-06');
  assert.equal(draft.type, 'salary');
  assert.equal(draft.amount, 1800);
  assert.equal(draft.employeeCount, 3);
  assert.equal(draft.employeeId, '');
  assert.equal(draft.date, '2026-11-06');
});

test('Tanglish salary and expense phrases are classified without saving', () => {
  assert.equal(prepareAssistantDraft('Innaiku sambalam 1800 rupees').type, 'salary');
  assert.equal(prepareAssistantDraft('Innaiku selavu 250 rupees').type, 'expense');
});

test('Tamil income statements require a positive explicit amount', () => {
  const draft = prepareAssistantDraft('இன்று 500 ரூபாய் வரவு கிடைத்தது');
  assert.equal(draft.type, 'income');
  assert.equal(draft.amount, 500);
  assert.throws(() => prepareAssistantDraft('இன்று சம்பளம் கொடுத்தேன்'), /could not find an amount/);
});

test('ambiguous statements are not silently classified as income', () => {
  assert.throws(() => prepareAssistantDraft('There were three workers at the shop for 500 rupees'), /could not identify this as salary/);
});

test('assistant extraction returns a draft and never writes a transaction', () => {
  const draft = prepareAssistantDraft('Received 2000 rupees customer payment');
  assert.equal(draft.type, 'income');
  assert.equal(draft.customerId, '');
  assert.ok(draft.note.includes('Review'));
});
