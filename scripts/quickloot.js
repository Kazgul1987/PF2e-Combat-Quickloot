// PF2e Combat Quickloot

// Zwischenspeicher für NPC-Items
const cachedNpcItems = new Map();

// Hook: Combatant wird erstellt → Items cachen
Hooks.on("createCombatant", combatant => {
  const actor = combatant.actor;
  if (!actor || actor.type !== "npc") return;
  cachedNpcItems.set(combatant.id, {
    combatId: combatant.parent?.id,
    actorId: actor.id,
    items: actor.items.filter(i => i.isPhysical)
  });
});

// Hooks: Items aktualisiert/gelöscht → Cache aktualisieren
function updateCachedActor(actor) {
  for (const data of cachedNpcItems.values()) {
    if (data.actorId === actor.id) {
      data.items = actor.items.filter(i => i.isPhysical);
    }
  }
}

Hooks.on("updateItem", item => {
  const actor = item.parent;
  if (actor?.type === "npc") updateCachedActor(actor);
});

Hooks.on("deleteItem", item => {
  const actor = item.parent;
  if (actor?.type === "npc") updateCachedActor(actor);
});

// Hook: bevor ein Kampf gelöscht wird → Loot-Dialog öffnen
Hooks.on("preDeleteCombat", async combat => {
  if (!game.user.isGM) return;

  collectCachedLoot(combat);
  const npcs = [];
  for (const c of combat.combatants) {
    const actor = c.actor;
    if (!actor || actor.type !== "npc" || actor.system.attributes.hp.value > 0) continue;

    const items = [];
    for (const item of actor.items.contents.filter(i => i.isPhysical)) {
      const mystified = (await item.getMystifiedData?.()) ?? {};
      items.push({
        item,
        qty: item.quantity ?? 1,
        name: mystified.name ?? item.name,
        identified: item.system.identification?.status !== "unidentified",
        magical: item.isMagical
      });
    }
    npcs.push({ id: actor.id, name: actor.name, items });
  }

  const hasLoot = npcs.some(n => n.items.length > 0);
  const html = await renderTemplate(
    "modules/pf2e-combat-quickloot/templates/loot-dialog.hbs",
    { npcs, actors: lootActors(), hasLoot }
  );

  new Dialog({
    title: "Quick Loot",
    content: html,
    buttons: { close: { label: "OK" } },
    default: "close",
    render: dlg => activateListeners(dlg)
  }).render(true);
});

// sammelt Items aller besiegten Gegner
function collectLoot(combat) {
  const loot = [];
  for (const c of combat.combatants) {
    const actor = c.actor;
    if (!actor || actor.system.attributes.hp.value > 0) continue;
    loot.push(...actor.items.contents.filter(item => item.isPhysical));
  }
  return loot;
}

// sammelt Items aus dem Zwischenspeicher
function collectCachedLoot(combat) {
  const loot = [];
  for (const [combatantId, data] of cachedNpcItems) {
    if (data.combatId !== combat.id) continue;
    const combatant = combat.combatants.get?.(combatantId);
    if (combatant) {
      const actor = combatant.actor;
      if (!actor || actor.system.attributes.hp.value > 0) continue;
    }
    loot.push(...data.items);
  }

  // Einträge für diesen Kampf entfernen
  for (const [combatantId, data] of Array.from(cachedNpcItems)) {
    if (data.combatId === combat.id) cachedNpcItems.delete(combatantId);
  }

  // Fallback auf Live-Daten, falls nichts gecached wurde
  if (!loot.length) return collectLoot(combat);
  return loot;
}

// listet mögliche Ziel-Actors auf
function lootActors() {
  return game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
}

// Dialog-Listener
function activateListeners(html) {
  html.find(".item-link").click(ev => {
    const row = ev.currentTarget.closest("tr");
    const actor = game.actors.get(row.dataset.actor);
    const item = actor?.items.get(row.dataset.item);
    item?.toMessage();
  });

  html.find(".transfer").click(async ev => {
    const row = ev.currentTarget.closest("tr");
    const actor = game.actors.get(row.dataset.actor);
    const item = actor?.items.get(row.dataset.item);
    const targetId = row.querySelector(".actor-select").value;
    const target = game.actors.get(targetId);
    await item?.transferToActor(target);
  });

  html.find(".identify").click(ev => {
    const row = ev.currentTarget.closest("tr");
    const actor = game.actors.get(row.dataset.actor);
    const item = actor?.items.get(row.dataset.item);
    if (item) game.pf2e.identification.startIdentification(item, {});
  });
}
