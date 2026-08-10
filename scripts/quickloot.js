/* PF2e Combat Quickloot - Foundry VTT 14 */

(() => {
  "use strict";

  const MODULE_ID = "pf2e-combat-quickloot";
  const PREFIX = "PF2e Combat Quickloot |";
  const TEMPLATE = `modules/${MODULE_ID}/templates/loot-dialog.hbs`;
  const TARGET_NAMES = Object.freeze(["Partystash", "Loot", "Sell"]);
  const ITEM_DC_BY_LEVEL = Object.freeze([
    14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30,
    31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50,
  ]);
  const RARITY_MODIFIERS = Object.freeze({ common: 0, uncommon: 2, rare: 5, unique: 10 });
  const HARD_DC_MODIFIER = 2;
  const MAGIC_TRADITION_SKILLS = Object.freeze({
    arcane: "arcana",
    primal: "nature",
    divine: "religion",
    occult: "occultism",
  });

  function notifyError(message, error) {
    console.error(`${PREFIX} ${message}`, error);
    ui.notifications.error(message);
  }

  function normalizeName(name) {
    return String(name ?? "").trim().toLocaleLowerCase();
  }

  /** Resolve the three deliberately fixed destinations and never return partial results. */
  function resolveTargetActors({ notify = true } = {}) {
    const partyActor = game.actors.party;
    const lootActor = game.actors.find((actor) => normalizeName(actor.name) === "loot") ?? null;
    const sellActor = game.actors.find((actor) => normalizeName(actor.name) === "sell") ?? null;
    const missing = [!lootActor && "Loot", !sellActor && "Sell"].filter(Boolean);
    const hasPartyActor = partyActor?.type === "party";

    if (!hasPartyActor && notify) {
      ui.notifications.error(
        `${PREFIX} Kein aktiver PF2e-Party-Actor gefunden. Der Partystash kann nicht verwendet werden.`,
      );
    }
    if (missing.length) {
      if (notify) {
        ui.notifications.error(
          `${PREFIX} Folgende Ziel-Actors fehlen: ${missing.join(", ")}. Der Loot-Dialog wurde nicht geöffnet.`,
        );
      }
    }
    if (!hasPartyActor || missing.length) return null;

    return {
      Partystash: partyActor,
      Loot: lootActor,
      Sell: sellActor,
    };
  }

  function isDefeated(combatant) {
    return combatant.defeated === true || Number(combatant.actor?.system?.attributes?.hp?.value) <= 0;
  }

  function isPhysicalItem(item) {
    return item?.isOfType?.("physical") === true;
  }

  function isItemIdentified(item) {
    return item.isIdentified ?? item.system?.identification?.status === "identified";
  }

  /** Return only data that is safe to render for the item's identification state. */
  function getSafeItemDisplayData(item) {
    if (isItemIdentified(item)) return { name: item.name, img: item.img };

    const fallback = { name: "Unidentifizierter Gegenstand", img: "icons/svg/item-bag.svg" };
    if (typeof item.getMystifiedData !== "function") return fallback;
    try {
      const mystified = item.getMystifiedData("unidentified");
      return {
        name: typeof mystified?.name === "string" && mystified.name ? mystified.name : fallback.name,
        img: typeof mystified?.img === "string" && mystified.img ? mystified.img : fallback.img,
      };
    } catch (error) {
      console.warn(`${PREFIX} Mystifizierte Item-Daten konnten nicht gelesen werden.`, error);
      return fallback;
    }
  }

  function collectLoot(combat) {
    const sections = [];
    const rows = new Map();

    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (!actor || actor.type !== "npc" || !isDefeated(combatant)) continue;

      const section = { name: actor.name, items: [] };
      console.debug(
        `${PREFIX} Prüfe Inventar von "${actor.name}"`,
        actor.items.map((item) => ({
          name: item.name,
          type: item.type,
          physical: isPhysicalItem(item),
        })),
      );
      for (const item of actor.items.filter((candidate) => isPhysicalItem(candidate))) {
        const quantity = Number(item.quantity ?? item.system?.quantity ?? 1);
        if (!Number.isFinite(quantity) || quantity < 1) continue;

        const key = foundry.utils.randomID();
        const identified = isItemIdentified(item);
        const display = getSafeItemDisplayData(item);
        const row = {
          key,
          sourceUuid: actor.uuid,
          itemId: item.id,
          quantity,
          identified,
          identifiable: !identified && (item.isMagical || item.isAlchemical),
          displayName: display.name,
        };
        rows.set(key, row);
        section.items.push({
          key,
          quantity,
          name: display.name,
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

  function getIdentificationBaseDC(item) {
    const level = Math.trunc(Number(item.level ?? item.system?.level?.value ?? 0));
    const standardDC = level <= -1 ? 13 : ITEM_DC_BY_LEVEL[Math.min(level, 25)];
    const pwolEnabled = game.pf2e?.settings?.variants?.pwol?.enabled === true;
    return pwolEnabled ? standardDC - Math.max(level, 0) : standardDC;
  }

  function getIdentificationRarityModifier(item) {
    const traits = item.traits;
    const cursed = typeof traits?.has === "function" && traits.has("cursed");
    const rarity = cursed ? "unique" : String(item.rarity ?? item.system?.traits?.rarity ?? "common").toLowerCase();
    return RARITY_MODIFIERS[rarity] ?? 0;
  }

  function getMagicTraditions(item) {
    const values = item.system?.traits?.value;
    const traits = new Set(Array.isArray(values) ? values : values instanceof Set ? values : []);
    return new Set(Object.keys(MAGIC_TRADITION_SKILLS).filter((tradition) => traits.has(tradition)));
  }

  function getIdentificationChecks(item) {
    const dc = getIdentificationBaseDC(item) + getIdentificationRarityModifier(item);
    if (item.isMagical === true) {
      const traditions = getMagicTraditions(item);
      return Object.entries(MAGIC_TRADITION_SKILLS).map(([tradition, skill]) => ({
        skill,
        dc: dc + (traditions.size > 0 && !traditions.has(tradition) ? HARD_DC_MODIFIER : 0),
      }));
    }
    return item.isAlchemical === true ? [{ skill: "crafting", dc }] : [];
  }

  async function postIdentificationChecks(item) {
    const dcs = getIdentificationChecks(item);
    const skillLabels = CONFIG.PF2E.skills ?? CONFIG.PF2E.skillList ?? {};
    const checks = dcs
      .filter(({ dc }) => Number.isFinite(dc))
      .map(({ skill, dc }) => {
        const label = game.i18n.localize(skillLabels[skill]?.label ?? skillLabels[skill] ?? `PF2E.Skill.${skill}`);
        return `<li>${foundry.utils.escapeHTML(label)} DC ${Number(dc)}</li>`;
      })
      .join("");
    if (!checks) throw new Error("Für diesen Gegenstand sind keine Identifikations-Checks verfügbar.");

    // Deliberately use only mystified plain text: no UUID, link, image, price, level, traits, or description.
    const name = foundry.utils.escapeHTML(getSafeItemDisplayData(item).name);
    await ChatMessage.create({
      user: game.user.id,
      content: `<section class="pf2e-quickloot-identification"><h3>Gegenstand identifizieren</h3><p>${name}</p><p><strong>Mögliche Identifikations-Checks</strong></p><ul>${checks}</ul></section>`,
    });
  }

  class QuickLootDialog extends foundry.applications.api.DialogV2 {
    constructor(options, rows) {
      super(options);
      this.rows = rows;
      this._distributing = false;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      this.element.querySelectorAll("button.identify").forEach((button) => {
        button.addEventListener("click", () => this._onIdentify(button.dataset.row));
      });
      this.element.querySelectorAll("button.item-link").forEach((button) => {
        button.addEventListener("click", () => this._onOpenItem(button.dataset.row));
      });
      const distributeButton = this.element.querySelector(".quickloot-distribute");
      distributeButton?.addEventListener("click", (event) => {
        void this.distribute(event, distributeButton);
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
        notifyError(`Identifikations-Checks konnten nicht gepostet werden: ${error.message}`, error);
      }
    }

    _removeRow(key) {
      this.rows.delete(key);
      const element = Array.from(this.element.querySelectorAll("tr[data-row]"))
        .find((candidate) => candidate.dataset.row === key);
      const section = element?.closest("section.quickloot-section");
      element?.remove();
      if (section && !section.querySelector("tr[data-row]")) section.remove();
    }

    async distribute(event, button) {
      event.preventDefault();
      if (this._distributing) return;
      this._distributing = true;
      button.disabled = true;

      try {
        const targets = resolveTargetActors();
        if (!targets) return;

        let failures = 0;
        for (const [key, row] of Array.from(this.rows)) {
          const source = await resolveSourceActor(row.sourceUuid);
          const item = source?.items.get(row.itemId);
          if (!source || !item || !isPhysicalItem(item)) {
            console.warn(`${PREFIX} Loot-Zeile ${key} wurde entfernt, da das Source-Item nicht mehr existiert.`);
            this._removeRow(key);
            continue;
          }

          const rowElement = Array.from(this.element.querySelectorAll("tr[data-row]"))
            .find((candidate) => candidate.dataset.row === key);
          const targetName = rowElement?.querySelector('input[type="radio"]:checked')?.value;
          const target = TARGET_NAMES.includes(targetName) ? targets[targetName] : null;
          try {
            if (!target) throw new Error("Der ausgewählte Target-Actor existiert nicht.");
            const quantity = Math.min(row.quantity, Number(item.quantity ?? 0));
            if (quantity < 1) {
              console.warn(`${PREFIX} Loot-Zeile ${key} wurde entfernt, da keine Item-Menge mehr verfügbar ist.`);
              this._removeRow(key);
              continue;
            }
            await transferPhysicalItem(source, target, item, quantity);
            this._removeRow(key); // A successful row can never be submitted a second time.
          } catch (error) {
            failures += 1;
            notifyError(
              `„${row.displayName}“ konnte nicht nach „${targetName ?? "unbekannt"}“ übertragen werden.`,
              error,
            );
          }
        }

        if (this.rows.size === 0) {
          if (!failures) ui.notifications.info(`${PREFIX} Loot wurde erfolgreich verteilt.`);
          await this.close();
        }
      } finally {
        this._distributing = false;
        if (this.rows.size > 0) button.disabled = false;
      }
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
            action: "close",
            label: "Schließen",
            icon: "fa-solid fa-xmark",
          },
        ],
      },
      rows,
    );
    dialog.render({ force: true });
  }

  Hooks.on("deleteCombat", (combat) => void showLootDialog(combat).catch((error) => {
    notifyError("Der Loot-Dialog konnte nicht geöffnet werden.", error);
  }));

  const namespace = (game.pf2eCombatQuickloot ??= {});
  Object.assign(namespace, {
    getIdentificationChecks,
    getIdentificationBaseDC,
    getIdentificationRarityModifier,
    getMagicTraditions,
    getSafeItemDisplayData,
    postIdentificationChecks,
    resolveTargetActors,
    showLootDialog,
  });
})();
