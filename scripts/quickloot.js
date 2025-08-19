// PF2e Combat Quickloot
// Hook: bevor ein Kampf gelöscht wird → Loot-Dialog öffnen
Hooks.on("preDeleteCombat", async combat => {
  if (!game.user.isGM) return;

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

// gruppiert gleichnamige Items
function groupItems(items) {
  const map = {};
  for (const item of items) {
    const key = item.slug ?? `${item.id}|${item.name}`;
    if (!map[key])
      map[key] = {
        item,
        qty: 0,
        name: item.slug ?? item.name
      };
    const entry = map[key];
    entry.qty++;
    entry.identified =
      item.system.identification?.status !== "unidentified";
    entry.magical = item.isMagical;
  }
  return Object.values(map);
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
