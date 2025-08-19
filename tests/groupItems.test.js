const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

global.Hooks = { on: () => {} };
global.game = { user: { isGM: false } };

const code = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'quickloot.js'), 'utf8');
vm.runInThisContext(code);

const items = [
  { id: 'a1', slug: 'arrow', name: 'Arrow', quantity: 10, isMagical: false, system: { identification: { status: 'identified' } } },
  { id: 'a2', slug: 'arrow', name: 'Arrow', quantity: 5, isMagical: false, system: { identification: { status: 'identified' } } },
  { id: 'b1', slug: 'sword', name: 'Sword', quantity: 1, isMagical: false, system: { identification: { status: 'identified' } } }
];

const grouped = groupItems(items);
const arrowEntry = grouped.find(i => i.name === 'arrow' || i.name === 'Arrow');
assert.strictEqual(arrowEntry.qty, 15);

console.log('groupItems quantity test passed');
