/* PF2e Combat Quickloot - Foundry VTT 14 */

(() => {
  "use strict";

  const MODULE_ID = "pf2e-combat-quickloot";
  const PREFIX = "PF2e Combat Quickloot |";
  const TEMPLATE = `modules/${MODULE_ID}/templates/loot-dialog.hbs`;
  const TARGET_NAMES = Object.freeze(["Partystash", "Loot", "Sell"]);

  function notifyError(message, error) {
    console.error(`${PREFIX} ${message}`, error);
    ui.notifications.error(message);
  }

  /** Resolve the three deliberately fixed destinations and never return partial results. */
  function resolveTargetActors({ notify = true } = {}) {
    const actors = TARGET_NAMES.map((name) => game.actors.find((actor) => actor.name === name) ?? null);
    const missing = TARGET_NAMES.filter((_name, index) => !actors[index]);
    if (missing.length) {
      if (notify) {
        ui.notifications.error(
          `${PREFIX} Folgende Ziel-Actors fehlen: ${missing.join(", ")}. Der Loot-Dialog wurde nicht geöffnet.`,
        );
      }
      return null;
    }
    return new Map(actors.map((actor) => [actor.name, actor]));
  }

  function isDefeated(combatant) {
    return combatant.defeated === true || Number(combatant.actor?.system?.attributes?.hp?.value) <= 0;
  }

  function safeItemName(item) {
    if (item.isIdentified ?? item.system?.identification?.status === "identified") return item.name;
    return (
      item.getMystifiedName?.() ??
      item.getMystifiedData?.("unidentified")?.name ??
      game.i18n.localize(`TYPES.Item.${item.type}`) ??
      "Unidentifizierter Gegenstand"
    );
  }

  function collectLoot(combat) {
    const sections = [];
    const rows = new Map();

    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (!actor || actor.type !== "npc" || !isDefeated(combatant)) continue;

      const section = { name: actor.name, items: [] };
      for (const item of actor.items.filter((candidate) => candidate.isPhysical === true)) {
        const quantity = Number(item.quantity ?? item.system?.quantity ?? 1);
        if (!Number.isFinite(quantity) || quantity < 1) continue;

        const key = foundry.utils.randomID();
        const identified = item.isIdentified ?? item.system?.identification?.status === "identified";
        const row = {
          key,
          sourceUuid: actor.uuid,
          itemId: item.id,
          quantity,
          identified,
          identifiable: !identified && (item.isMagical || item.isAlchemical),
        };
        rows.set(key, row);
        section.items.push({
          key,
          quantity,
          name: safeItemName(item),
          identified,
          identifiable: row.identifiable,
        });
      }
      if (section.items.length) sections.push(section);
    }
    return { sections, rows };
  }

  async function resolveSourceActor(uuid) {
    const actor = await fromUuid(uuid);
    return actor?.documentName === "Actor" ? actor : null;
  }

  async function transferPhysicalItem(source, target, item, quantity) {
    if (typeof source.transferItemToActor === "function") {
      return source.transferItemToActor(target, item, quantity);
    }
    if (typeof item.transferToActor === "function") {
      return item.transferToActor(target, quantity);
    }
    throw new Error("Die installierte PF2e-Version stellt keine unterstützte Item-Transfer-API bereit.");
  }

  /**
   * Adapter for PF2e's identification API. Keeping this isolated makes adding the
   * actual skill roll and setIdentificationStatus("identified") straightforward.
   */
  function getIdentificationDCs(item) {
    const api = game.pf2e?.identification;
    const options = {
      pwol: game.pf2e?.settings?.variants?.pwol?.enabled ?? false,
      notMatchingTraditionModifier: game.settings.get("pf2e", "identifyMagicNotMatchingTraditionModifier"),
    };
    const candidates = [
      () => item.getIdentificationDCs?.(options),
      () => api?.getItemIdentificationDCs?.(item, options),
      () => api?.getIdentificationDCs?.(item, options),
    ];
    for (const candidate of candidates) {
      const dcs = candidate();
      if (dcs && typeof dcs === "object") return dcs;
    }
    throw new Error(
      "Die PF2e-Identification-API ist in dieser Systemversion nicht öffentlich verfügbar. Es werden bewusst keine DCs hartcodiert.",
    );
  }

  async function postIdentificationChecks(item) {
    const dcs = getIdentificationDCs(item);
    const skillLabels = CONFIG.PF2E.skills ?? CONFIG.PF2E.skillList ?? {};
    const checks = Object.entries(dcs)
      .filter(([, dc]) => Number.isFinite(Number(dc)))
      .map(([skill, dc]) => {
        const label = game.i18n.localize(skillLabels[skill]?.label ?? skillLabels[skill] ?? `PF2E.Skill.${skill}`);
        return `<li>${foundry.utils.escapeHTML(label)} DC ${Number(dc)}</li>`;
      })
      .join("");
    if (!checks) throw new Error("PF2e hat für diesen Gegenstand keine möglichen Identifikations-Checks geliefert.");

    // Deliberately use only mystified plain text: no UUID, link, image, price, level, traits, or description.
    const name = foundry.utils.escapeHTML(safeItemName(item));
    const action = item.isMagical ? "Identify Magic" : item.isAlchemical ? "Identify Alchemy" : "Identify Item";
    await ChatMessage.create({
      user: game.user.id,
      content: `<section class="pf2e-quickloot-identification"><h3>${action}</h3><p>${name}</p><p><strong>Possible Checks:</strong></p><ul>${checks}</ul></section>`,
    });
  }

  class QuickLootDialog extends foundry.applications.api.DialogV2 {
    constructor(options, rows) {
      super(options);
      this.rows = rows;
      this.distributing = false;
    }

    _onRender(context, options) {
      super._onRender(context, options);
      this.element.querySelectorAll("button.identify").forEach((button) => {
        button.addEventListener("click", () => this._onIdentify(button.dataset.row));
      });
      this.element.querySelectorAll("button.item-link").forEach((button) => {
        button.addEventListener("click", () => this._onOpenItem(button.dataset.row));
      });
    }

    async _getCurrentItem(key) {
      const row = this.rows.get(key);
      const source = row ? await resolveSourceActor(row.sourceUuid) : null;
      return { row, source, item: source?.items.get(row?.itemId) ?? null };
    }

    async _onOpenItem(key) {
      const { row, item } = await this._getCurrentItem(key);
      // Sheets are offered only for identified items. This is a second guard against forged DOM events.
      if (row?.identified && item?.isIdentified !== false) item.sheet.render({ force: true });
    }

    async _onIdentify(key) {
      const { row, item } = await this._getCurrentItem(key);
      if (!row || !item) return ui.notifications.error(`${PREFIX} Der Gegenstand existiert nicht mehr.`);
      try {
        await postIdentificationChecks(item);
      } catch (error) {
        notifyError(`${PREFIX} Identifikations-Checks konnten nicht gepostet werden: ${error.message}`, error);
      }
    }

    async distribute(event, button) {
      event.preventDefault();
      if (this.distributing) return false;
      this.distributing = true;
      button.disabled = true;

      const targets = resolveTargetActors();
      if (!targets) {
        this.distributing = false;
        button.disabled = false;
        return false;
      }

      const form = this.element.querySelector("form.quickloot");
      const failures = [];
      for (const [key, row] of this.rows) {
        const targetName = new FormData(form).get(`target-${key}`);
        const target = targets.get(targetName);
        try {
          const source = await resolveSourceActor(row.sourceUuid);
          const item = source?.items.get(row.itemId);
          if (!source) throw new Error("Source-Actor existiert nicht mehr.");
          if (!item || item.isPhysical !== true) throw new Error("Das physische Source-Item existiert nicht mehr.");
          if (!target) throw new Error("Der ausgewählte Target-Actor existiert nicht.");
          const quantity = Math.min(row.quantity, Number(item.quantity ?? 0));
          if (quantity < 1) throw new Error("Die Item-Menge ist nicht mehr verfügbar.");
          await transferPhysicalItem(source, target, item, quantity);
          this.rows.delete(key); // A successful row can never be submitted a second time.
        } catch (error) {
          console.error(`${PREFIX} Transfer von Loot-Zeile ${key} fehlgeschlagen.`, error);
          failures.push(error.message);
        }
      }

      if (failures.length) {
        ui.notifications.error(`${PREFIX} ${failures.length} Transfer(s) fehlgeschlagen: ${failures.join(" ")}`);
        this.distributing = false;
        button.disabled = false;
        return false;
      }
      ui.notifications.info(`${PREFIX} Alle Items wurden verteilt.`);
      return true;
    }
  }

  async function showLootDialog(combat) {
    if (!game.user.isGM) return;
    const targets = resolveTargetActors();
    if (!targets) return;
    const { sections, rows } = collectLoot(combat);
    if (!rows.size) return ui.notifications.info(`${PREFIX} Die besiegten Gegner haben keine physische Beute.`);

    const content = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
      sections,
      targets: TARGET_NAMES,
    });
    const dialog = new QuickLootDialog(
      {
        id: `${MODULE_ID}-dialog`,
        window: { title: "PF2e Combat Quickloot" },
        position: { width: 760 },
        modal: true,
        content,
        buttons: [
          {
            action: "distribute",
            label: "Items verteilen",
            icon: "fa-solid fa-box-open",
            default: true,
            callback: (event, button) => dialog.distribute(event, button),
          },
        ],
      },
      rows,
    );
    dialog.render({ force: true });
  }

  Hooks.on("deleteCombat", (combat) => void showLootDialog(combat).catch((error) => {
    notifyError(`${PREFIX} Der Loot-Dialog konnte nicht geöffnet werden.`, error);
  }));

  const namespace = (game.pf2eCombatQuickloot ??= {});
  Object.assign(namespace, { resolveTargetActors, showLootDialog });
})();
