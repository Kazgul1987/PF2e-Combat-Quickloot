// PF2e Combat Quickloot

Hooks.on("preDeleteCombat", async (combat) => {
  if (!game.user.isGM) return;

  const npcs = [];
  for (const c of combat.combatants) {
    const actor = c.actor;
    if (
      !actor ||
      actor.type !== "npc" ||
      actor.system.attributes.hp.value > 0
    )
      continue;

    const items = actor.items
      .filter((i) => i.isPhysical)
      .map((item) => ({
        item,
        qty: item.quantity ?? 1,
        name: item.getMystifiedName?.() ?? item.name,
        identified: item.system?.identification?.status === "identified",
        magical: item.isMagical,
      }));

    npcs.push({
      id: actor.id,
      name: actor.name,
      items: collectCachedLoot({ id: actor.id, items }),
    });
  }

  const hasLoot = npcs.some((n) => n.items.length > 0);
  const html = await renderTemplate(
    "modules/pf2e-combat-quickloot/templates/loot-dialog.hbs",
    {
      npcs,
      actors: lootActors(),
      hasLoot,
    }
  );

  new QuickLootDialog({
    title: "Quick Loot",
    content: html,
    buttons: { ok: { label: "OK" } },
    default: "ok",
  }).render(true);
});

class QuickLootDialog extends Dialog {
  activateListeners(html) {
    super.activateListeners(html);

    html.find(".item-link").click((ev) => {
      const itemId = ev.currentTarget.closest("tr").dataset.item;
      const actorId = ev.currentTarget.closest("tr").dataset.actor;
      const actor = game.actors.get(actorId);
      actor?.items.get(itemId)?.sheet.render(true);
    });

    html.find(".transfer").click(async (ev) => {
      const tr = ev.currentTarget.closest("tr");
      const itemId = tr.dataset.item;
      const sourceId = tr.dataset.actor;
      const targetId = tr.querySelector(".actor-select").value;
      const source = game.actors.get(sourceId);
      const target = game.actors.get(targetId);
      const item = source?.items.get(itemId);
      if (source && target && item) {
        await item.transferToActor?.(target, item.quantity);
        this.render(false);
      }
    });

    html.find(".identify").click(async (ev) => {
      const tr = ev.currentTarget.closest("tr");
      const itemId = tr.dataset.item;
      const actorId = tr.dataset.actor;
      const actor = game.actors.get(actorId);
      const item = actor?.items.get(itemId);
      if (item) {
        await item.setIdentificationStatus?.("identified");
        this.render(false);
      }
    });
  }
}

function lootActors() {
  return game.actors
    .filter((a) => a.hasPlayerOwner && a.type === "character")
    .map((a) => ({ id: a.id, name: a.name }));
}

const _lootCache = new Map();

function collectCachedLoot({ id, items }) {
  const cached = _lootCache.get(id) ?? [];
  const grouped = groupItems([...cached, ...items]);
  _lootCache.delete(id);
  return grouped;
}

function groupItems(items) {
  const groups = [];
  for (const item of items) {
    const existing = groups.find(
      (i) =>
        i.item.id === item.item.id &&
        i.identified === item.identified &&
        i.magical === item.magical
    );
    if (existing) existing.qty += item.qty;
    else groups.push({ ...item });
  }
  return groups;
}

