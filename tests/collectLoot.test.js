const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// Stub foundry environment
global.Hooks = { on: () => {} };
global.game = { user: { isGM: false } };

// Load the script to access collectLoot
const code = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'quickloot.js'), 'utf8');
vm.runInThisContext(code);

// Typical combat data
const combat = {
  combatants: [
    {
      actor: {
        system: { attributes: { hp: { value: 0 } } },
        items: {
          contents: [
            { name: 'Gold Coin', type: 'treasure', system: {}, isPhysical: true },
            { name: 'Sword', type: 'weapon', system: { equipped: false }, isPhysical: true },
            {
              name: 'Equipped Necklace',
              type: 'treasure',
              system: { equipped: true },
              isPhysical: true
            },
            { name: 'Gem', type: 'treasure', system: { equipped: false }, isPhysical: true }
          ]
        }
      }
    },
    {
      actor: {
        system: { attributes: { hp: { value: 10 } } },
        items: {
          contents: [
            { name: 'Alive Treasure', type: 'treasure', system: {}, isPhysical: true }
          ]
        }
      }
    }
  ]
};

const loot = collectLoot(combat);

assert.deepStrictEqual(
  loot.map(i => i.name).sort(),
  ['Gold Coin', 'Sword', 'Equipped Necklace', 'Gem'].sort()
);

console.log('collectLoot test passed');
