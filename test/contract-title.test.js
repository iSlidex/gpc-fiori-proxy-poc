const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../webapp/poc/request-contract.js'), 'utf8');
const scope = {};
vm.runInNewContext(source.slice(source.indexOf('function buildContractTitle(')), scope);
const build = scope.buildContractTitle;
test('formats the title with a terminal opportunity identifier', () => {
  assert.equal(build('ABC', 'Cliente', 'Alquiler', '274'), 'ABC. Cliente. CONTRATO Alquiler. CX274');
});
test('rejects missing fields and unsafe IDs', () => {
  assert.throws(() => build('', 'Cliente', 'Alquiler', '274'));
  assert.throws(() => build('ABC', 'Cliente', 'Alquiler', "274'"));
});
test('accepts 128 characters, refuses overflow without truncating the identifier', () => {
  const base = build('ABC', 'X', 'Alquiler', '274');
  assert.equal(build('ABC', 'X'.repeat(129-base.length), 'Alquiler', '274').length, 128);
  assert.throws(() => build('ABC', 'X'.repeat(130-base.length), 'Alquiler', '274'));
});
