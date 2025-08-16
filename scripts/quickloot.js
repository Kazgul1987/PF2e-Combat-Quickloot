// PF2e Combat Quickloot
// Hook: sobald ein Kampf gelöscht wird → Loot-Dialog öffnen
Hooks.on("deleteCombat", async combat => {
  if (!game.user.isGM) return;

  const loot = collectLoot(combat);
  const grouped = groupItems(loot);
  const html = await renderTemplate(
    "modules/pf2e-combat-quickloot/templates/loot-dialog.hbs",
    { items: grouped, actors: lootActors(), hasLoot: loot.length > 0 }
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
    loot.push(
      ...actor.items.contents.filter(
        item => item.type === "treasure" && !item.system?.equipped
      )
    );
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
    const id = ev.currentTarget.dataset.item;
    game.items.get(id)?.sheet.render(true);
  });

  html.find(".transfer").click(async ev => {
    const row = ev.currentTarget.closest("tr");
    const item = game.items.get(row.dataset.item);
    const targetId = row.querySelector(".actor-select").value;
    const target = game.actors.get(targetId);
    await item?.transferToActor(target);
  });

  html.find(".identify").click(ev => {
    const item = game.items.get(ev.currentTarget.dataset.item);
    if (item) game.pf2e.identification.startIdentification(item, {});
  });
}
