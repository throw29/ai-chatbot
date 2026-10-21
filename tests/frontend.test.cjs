const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
  const saved = new Map();
  const toasts = [];
  const document = { readyState: 'loading', addEventListener() {}, documentElement: { dataset: { view: 'chat' } } };
  const window = { matchMedia: () => ({ matches: false }), confirm: () => false };
  const localStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: key => saved.delete(key),
  };
  const context = vm.createContext({ window, document, navigator: {}, localStorage, Intl, Date, console });
  const source = fs.readFileSync(path.join(__dirname, '../app/static/js/app.js'), 'utf8');
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, `
    showToast = (...args) => window.toasts.push(args);
    window.test = { state, els, loadSessions, loadPersona, buildContextMessages, finishSetup, sendMessage };
  })();`), context);
  window.toasts = toasts;
  return { ...window.test, window, document, localStorage, saved, toasts };
}
const message = (role, content) => ({ role, content });

test('long model answers cannot poison the next request; original is preserved', () => {
  const h = harness();
  const session = { messages: [message('user', 'hello'), message('assistant', '中'.repeat(25000)), message('user', 'continue')] };
  const context = h.buildContextMessages(session);
  assert.equal(context.length, 3);
  assert.equal(context[1].content.length, 20000);
  assert.equal(session.messages[1].content.length, 25000);
});

test('context respects message count, total size, greetings, and user-first boundary', () => {
  const h = harness();
  const messages = [{ role: 'assistant', content: 'welcome', kind: 'greeting' }];
  for (let i = 0; i < 40; i++) messages.push(message(i % 2 ? 'assistant' : 'user', 'x'.repeat(12000)));
  messages.push(message('user', 'latest'));
  const result = h.buildContextMessages({ messages });
  assert.ok(result.length <= 30);
  assert.ok(result.reduce((n, m) => n + m.content.length, 0) <= 90000);
  assert.equal(result[0].role, 'user');
  assert.equal(result.at(-1).content, 'latest');
  assert.ok(!result.some(m => m.content === 'welcome'));
});

test('context clipping does not split Unicode surrogate pairs', () => {
  const h = harness();
  const result = h.buildContextMessages({ messages: [message('user', 'start'), message('assistant', '😀'.repeat(20001)), message('user', 'next')] });
  assert.equal(Array.from(result[1].content).length, 20000);
  assert.ok(result[1].content.endsWith('😀'));
});

test('persona save failure preserves both previous profile and chat storage', () => {
  const h = harness();
  h.state.persona = { name: '旧名字', personality: 'gentle' };
  h.state.sessions = [{ id: 'old', messages: [message('user', 'keep me')] }];
  h.saved.set('aurora.sessions.v1', 'original history');
  h.state.setupDraft = { personality: 'sunny' };
  h.els.personaNameInput = { value: '新名字' };
  h.window.confirm = () => true;
  h.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  h.finishSetup();
  assert.equal(h.state.persona.name, '旧名字');
  assert.equal(h.state.sessions[0].messages[0].content, 'keep me');
  assert.equal(h.saved.get('aurora.sessions.v1'), 'original history');
  assert.match(h.toasts[0][0], /保存失败/);
});

test('legacy history reset requires consent even without a saved persona', () => {
  const h = harness();
  h.saved.set('aurora.sessions.v1', JSON.stringify([{ id: 'legacy', messages: [message('user', 'old history')] }]));
  h.loadSessions();
  h.state.setupDraft = { personality: 'gentle' };
  h.els.personaNameInput = { value: '晚晚' };
  let confirmed = 0;
  h.window.confirm = () => { confirmed++; return false; };
  h.finishSetup();
  assert.equal(confirmed, 1);
  assert.equal(h.state.persona, null);
  assert.equal(h.state.sessions[0].messages[0].content, 'old history');
  assert.equal(h.saved.has('aurora.persona.v1'), false);
});

test('oversized pasted input is rejected before altering history', () => {
  const h = harness();
  h.state.persona = { name: '晚晚', personality: 'gentle' };
  h.sendMessage('x'.repeat(12001));
  assert.equal(h.state.sessions.length, 0);
  assert.match(h.toasts[0][0], /消息过长/);
});
