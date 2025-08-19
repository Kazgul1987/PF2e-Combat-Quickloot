// PF2e Combat Quickloot

Hooks.on("preDeleteCombat", async combat => {
  if (!game.user.isGM) return;

  const npcs = [];
  for (const c of combat.combatants) {
    const actor = c.actor;
    if (!actor || actor.type !== "npc" || actor.system.attributes.hp.value > 0) continue;
    npcs.push({ id: actor.id, name: actor.name });
  }

  const html = await renderTemplate(
    "modules/pf2e-combat-quickloot/templates/npc-list-dialog.hbs",
    { npcs }
  );

  new Dialog({
    title: "Quick Loot",
    content: html,
    buttons: { ok: { label: "OK" } },
    default: "ok"
  }).render(true);
});
