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
  const IDENTIFICATION_OPTION_PREFIX = `${MODULE_ID}:identify:`;
  const openLootRows = new Map();
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

  function isQuicklootMystifiable(item) {
    const traits = item?.traits;
    return item?.isMagical === true || item?.isAlchemical === true
      || traits?.has?.("magical") === true || traits?.has?.("alchemical") === true;
  }

  /** Return only PF2e's substitution data, never data from the identified item. */
  function getMystifiedDisplayData(item) {
    const fallback = {
      name: "Unidentifizierter Gegenstand",
      img: "icons/svg/item-bag.svg",
      description: "",
    };
    if (typeof item.getMystifiedData !== "function") return fallback;
    try {
      const mystified = item.getMystifiedData("unidentified");
      return {
        name: typeof mystified?.name === "string" && mystified.name ? mystified.name : fallback.name,
        img: typeof mystified?.img === "string" && mystified.img ? mystified.img : fallback.img,
        description: typeof mystified?.data?.description?.value === "string"
          ? mystified.data.description.value
          : "",
      };
    } catch (error) {
      console.warn(`${PREFIX} Mystifizierte Item-Daten konnten nicht gelesen werden.`, error);
      return fallback;
    }
  }

  /** Inventory consumers still need to respect an item's persistent PF2e identification state. */
  function getSafeItemDisplayData(item) {
    const identified = item.isIdentified ?? item.system?.identification?.status === "identified";
    return identified ? { name: item.name, img: item.img } : getMystifiedDisplayData(item);
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  /**
   * Stack identity uses PF2e's stable compendium/source UUID when available and a
   * sanitized system-data fingerprint. Actor/document IDs, quantity, location and
   * persistent identification state are deliberately excluded.
   */
  function getLootStackKey(item) {
    const sourceData = item.toJSON();
    const sourceId = item.sourceId
      ?? item.flags?.core?.sourceId
      ?? item._stats?.compendiumSource
      ?? sourceData?._stats?.compendiumSource
      ?? null;
    const system = foundry.utils.deepClone(sourceData.system ?? {});
    delete system.quantity;
    delete system.identification;
    delete system.containerId;
    delete system.equipped;
    const identity = {
      type: sourceData.type,
      sourceId,
      name: sourceData.name,
      system,
    };
    return stableStringify(identity);
  }

  function updateRowQuantity(row) {
    row.quantity = row.sources.reduce((total, source) => total + Number(source.quantity || 0), 0);
  }

  function collectLoot(combat) {
    const rows = new Map();
    const stacks = new Map();

    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (!actor || actor.type !== "npc" || !isDefeated(combatant)) continue;

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

        const stackKey = getLootStackKey(item);
        let row = stacks.get(stackKey);
        if (!row) {
          const key = foundry.utils.randomID();
          const quicklootIdentified = !isQuicklootMystifiable(item);
          const display = quicklootIdentified ? { name: item.name, img: item.img } : getMystifiedDisplayData(item);
          row = {
            key,
            sources: [],
            quantity: 0,
            target: TARGET_NAMES[0],
            quicklootIdentified,
            mystifiable: !quicklootIdentified,
            displayName: display.name,
            displayImg: display.img,
          };
          stacks.set(stackKey, row);
          openLootRows.set(key, row);
          rows.set(key, row);
        }
        row.sources.push({ sourceActorId: actor.id, sourceUuid: actor.uuid, itemId: item.id, quantity });
        updateRowQuantity(row);
      }
    }
    const sections = [{
      name: "Beute",
      items: Array.from(rows.values(), (row) => ({
        key: row.key,
        quantity: row.quantity,
        name: row.displayName,
        img: row.displayImg,
        quicklootIdentified: row.quicklootIdentified,
        showIdentify: row.mystifiable && !row.quicklootIdentified,
        showReveal: row.mystifiable && !row.quicklootIdentified,
        target: row.target,
        sourceCount: new Set(row.sources.map((source) => source.sourceActorId)).size,
      })),
    }];
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

  /** Keep PF2e's persistent status aligned with the state shown in Quickloot before transfer. */
  async function synchronizeIdentificationStatus(item, row) {
    if (!row.mystifiable || !isPhysicalItem(item)) return;
    if (typeof item.setIdentificationStatus !== "function") return;

    const status = row.quicklootIdentified ? "identified" : "unidentified";
    await item.setIdentificationStatus(status);
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
    if (item.isMagical === true || item.traits?.has?.("magical") === true) {
      const traditions = getMagicTraditions(item);
      return Object.entries(MAGIC_TRADITION_SKILLS).map(([tradition, skill]) => ({
        skill,
        dc: dc + (traditions.size > 0 && !traditions.has(tradition) ? HARD_DC_MODIFIER : 0),
      }));
    }
    return item.isAlchemical === true || item.traits?.has?.("alchemical") === true
      ? [{ skill: "crafting", dc }]
      : [];
  }

  /** Never fall back to the actual item name while Quickloot still treats an item as mystified. */
  function getSafeMystifiedName(item, mystified = getMystifiedDisplayData(item)) {
    return mystified.name && mystified.name !== item.name
      ? mystified.name
      : "Unidentifizierter Gegenstand";
  }

  async function postIdentificationChecks(item, row) {
    row.checkId ??= foundry.utils.randomID();
    const dcs = getIdentificationChecks(item);
    const skillLabels = CONFIG.PF2E.skills ?? CONFIG.PF2E.skillList ?? {};
    const checks = dcs
      .filter(({ dc }) => Number.isFinite(dc))
      .map(({ skill, dc }) => {
        const label = game.i18n.localize(skillLabels[skill]?.label ?? skillLabels[skill] ?? `PF2E.Skill.${skill}`);
        return `@Check[${skill}|dc:${Number(dc)}|traits:secret|options:${IDENTIFICATION_OPTION_PREFIX}${row.checkId}]{${foundry.utils.escapeHTML(label)}}`;
      })
      .join("<br>");
    if (!checks) throw new Error("Für diesen Gegenstand sind keine Identifikations-Checks verfügbar.");

    // Deliberately use only mystified plain text: no UUID, link, image, price, level, traits, or description.
    const mystified = getMystifiedDisplayData(item);
    const safeName = foundry.utils.escapeHTML(getSafeMystifiedName(item, mystified));
    const rawContent = `<section class="pf2e-quickloot-identification"><h3 class="pf2e-quickloot-mystified-name">${row.quantity} × ${safeName}</h3><p><strong>Gegenstand identifizieren</strong></p><p><strong>Mögliche Identifikations-Checks</strong></p>${checks}</section>`;
    const content = await foundry.applications.ux.TextEditor.enrichHTML(rawContent, {
      async: true,
      secrets: false,
    });
    await ChatMessage.create({
      user: game.user.id,
      content,
      flags: {
        [MODULE_ID]: {
          action: "identify",
          rowKey: row.key,
          checkId: row.checkId,
        },
      },
    });
  }

  function escapeAttribute(value) {
    return foundry.utils.escapeHTML(String(value ?? "")).replaceAll('"', "&quot;");
  }

  /** Create a chat message whose visibility never inherits the user's current chat mode. */
  async function createPublicChatMessage(data) {
    const source = typeof data?.toObject === "function" ? data.toObject() : data;
    const chatData = ChatMessage.applyMode({ ...source }, "public");
    return ChatMessage.create(chatData);
  }

  async function postItemToChat(item, row) {
    if (row.quicklootIdentified) {
      if (row.quantity > 1) {
        const rawContent = `<article class="pf2e-quickloot-stack"><h3>${row.quantity} × @UUID[${escapeAttribute(item.uuid)}]{${foundry.utils.escapeHTML(item.name)}}</h3></article>`;
        const content = await foundry.applications.ux.TextEditor.enrichHTML(rawContent, { async: true, secrets: false });
        return createPublicChatMessage({ user: game.user.id, content });
      }
      if (typeof item.toMessage === "function") {
        const message = await item.toMessage(undefined, { create: false });
        if (message) return createPublicChatMessage(message);
      }

      // `toChat()` creates immediately and can inherit the global mode, so use a safe identified fallback instead.
      const rawContent = `<article class="pf2e-quickloot-stack"><h3>@UUID[${escapeAttribute(item.uuid)}]{${foundry.utils.escapeHTML(item.name)}}</h3></article>`;
      const content = await foundry.applications.ux.TextEditor.enrichHTML(rawContent, { async: true, secrets: false });
      return createPublicChatMessage({ user: game.user.id, content });
    }

    const mystified = getMystifiedDisplayData(item);
    const safeName = getSafeMystifiedName(item, mystified);
    const safeDescription = mystified.description.includes(item.name) || /@UUID\s*\[/i.test(mystified.description)
      ? ""
      : mystified.description;
    // This deliberately has no UUID, item data attributes, level, price, traits, runes, or hidden elements.
    const content = `<article class="pf2e-quickloot-mystified"><h3 class="pf2e-quickloot-mystified-name">${row.quantity} × ${foundry.utils.escapeHTML(safeName)}</h3><img src="${escapeAttribute(mystified.img)}" alt="Unidentifizierter Gegenstand"><p>${foundry.utils.escapeHTML(safeDescription)}</p></article>`;
    if (content.includes(item.name) || /@UUID\s*\[/i.test(content)) {
      throw new Error("Der mystifizierte Chat-Inhalt hat die Sicherheitsprüfung nicht bestanden.");
    }
    return createPublicChatMessage({ user: game.user.id, content });
  }

  class QuickLootDialog extends foundry.applications.api.DialogV2 {
    constructor(options, rows) {
      super(options);
      this.rows = rows;
      this._distributing = false;
      this._identifyingAll = false;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      this.element.querySelectorAll("button.identify").forEach((button) => {
        button.addEventListener("click", () => this._onIdentify(button.dataset.row));
      });
      this.element.querySelectorAll("button.quickloot-reveal").forEach((button) => {
        button.addEventListener("click", () => this._onReveal(button.dataset.row));
      });
      this.element.querySelectorAll("button.quickloot-chat").forEach((button) => {
        button.addEventListener("click", () => this._onChat(button.dataset.row));
      });
      this.element.querySelectorAll('input[type="radio"][data-row]').forEach((input) => {
        input.addEventListener("change", () => {
          const row = this.rows.get(input.dataset.row);
          if (row && TARGET_NAMES.includes(input.value)) row.target = input.value;
        });
      });
      this.element.querySelectorAll("button.item-link").forEach((button) => {
        button.addEventListener("click", () => this._onOpenItem(button.dataset.row));
      });
      const distributeButton = this.element.querySelector(".quickloot-distribute");
      distributeButton?.addEventListener("click", (event) => {
        void this.distribute(event, distributeButton);
      });
      const identifyAllButton = this.element.querySelector(".quickloot-identify-all");
      identifyAllButton?.addEventListener("click", () => {
        void this._onIdentifyAll(identifyAllButton);
      });
    }

    async _getCurrentStack(key) {
      const row = this.rows.get(key);
      if (!row) return { row: null, entries: [], representativeItem: null };
      const entries = [];
      for (const sourceEntry of row.sources) {
        const source = await resolveSourceActor(sourceEntry.sourceUuid);
        const item = source?.items.get(sourceEntry.itemId) ?? null;
        const quantity = Math.min(Number(sourceEntry.quantity), Number(item?.quantity ?? item?.system?.quantity ?? 0));
        if (source && item && isPhysicalItem(item) && quantity > 0) {
          sourceEntry.quantity = quantity;
          entries.push({ source: sourceEntry, actor: source, item, quantity });
        }
      }
      row.sources = entries.map((entry) => entry.source);
      updateRowQuantity(row);
      if (!entries.length) this._removeRow(key);
      const representativeItem = entries[0]?.item ?? null;
      return { row: entries.length ? row : null, entries, representativeItem };
    }

    async _onOpenItem(key) {
      const { row, representativeItem: item } = await this._getCurrentStack(key);
      // Sheets are offered only for identified items. This is a second guard against forged DOM events.
      if (row?.quicklootIdentified) item?.sheet.render({ force: true });
    }

    async _onIdentify(key) {
      const { row, representativeItem: item } = await this._getCurrentStack(key);
      if (!row || !item) return ui.notifications.error(`${PREFIX} Der Gegenstand existiert nicht mehr.`);
      try {
        if (!row.mystifiable || row.quicklootIdentified) return;
        await postIdentificationChecks(item, row);
      } catch (error) {
        notifyError(`Identifikations-Checks konnten nicht gepostet werden: ${error.message}`, error);
      }
    }

    async _onReveal(key) {
      const { row, entries, representativeItem: item } = await this._getCurrentStack(key);
      if (!row || !item || !row.mystifiable || row.quicklootIdentified) return;

      row.quicklootIdentified = true;
      row.displayName = item.name;
      row.displayImg = item.img;
      this.revealRow(key);

      for (const entry of entries) {
        if (typeof entry.item.setIdentificationStatus !== "function") continue;
        try {
          await entry.item.setIdentificationStatus("identified");
        } catch (error) {
          console.warn(`${PREFIX} Ein Source-Item des Stacks konnte nicht persistent identifiziert werden.`, error);
        }
      }
    }

    async _onIdentifyAll(button) {
      if (this._identifyingAll) return;
      this._identifyingAll = true;
      button.disabled = true;
      try {
        const candidates = Array.from(this.rows.values())
          .filter((row) => row.mystifiable && !row.quicklootIdentified);
        if (!candidates.length) {
          ui.notifications.info("Es gibt keine nicht identifizierten Gegenstände.");
          return;
        }

        for (const row of candidates) {
          try {
            const current = await this._getCurrentStack(row.key);
            if (!current.row || !current.representativeItem) {
              console.warn(`${PREFIX} Identifikations-Checks für Loot-Zeile ${row.key} wurden übersprungen: Source-Item fehlt.`);
              continue;
            }
            // Recheck after awaiting the source actor so a concurrent reveal remains idempotent.
            if (!current.row.mystifiable || current.row.quicklootIdentified) continue;
            await postIdentificationChecks(current.representativeItem, current.row);
          } catch (error) {
            console.warn(`${PREFIX} Identifikations-Checks für Loot-Zeile ${row.key} konnten nicht gepostet werden.`, error);
          }
        }
      } finally {
        this._identifyingAll = false;
        button.disabled = false;
      }
    }

    async _onChat(key) {
      const { row, representativeItem: item } = await this._getCurrentStack(key);
      if (!row || !item) return ui.notifications.error(`${PREFIX} Der Gegenstand existiert nicht mehr.`);
      try {
        await postItemToChat(item, row);
      } catch (error) {
        notifyError(`Der Gegenstand konnte nicht in den Chat gepostet werden: ${error.message}`, error);
      }
    }

    revealRow(key) {
      const row = this.rows.get(key);
      const element = this.element.querySelector(`tr[data-row="${CSS.escape(key)}"]`);
      if (!row || !element) return;
      const nameCell = element.querySelector("td.item-name");
      if (nameCell) {
        nameCell.innerHTML = `<img src="${escapeAttribute(row.displayImg)}" alt=""><button type="button" class="item-link" data-row="${escapeAttribute(key)}">${foundry.utils.escapeHTML(row.displayName)}</button>`;
        nameCell.querySelector("button.item-link")?.addEventListener("click", () => this._onOpenItem(key));
      }
      element.querySelector("button.identify")?.remove();
      element.querySelector("button.quickloot-reveal")?.remove();
    }

    _removeRow(key) {
      this.rows.delete(key);
      openLootRows.delete(key);
      const element = Array.from(this.element.querySelectorAll("tr[data-row]"))
        .find((candidate) => candidate.dataset.row === key);
      const section = element?.closest("section.quickloot-section");
      element?.remove();
      if (section && !section.querySelector("tr[data-row]")) section.remove();
    }

    _refreshRowQuantity(row) {
      updateRowQuantity(row);
      const cell = this.element.querySelector(`tr[data-row="${CSS.escape(row.key)}"] td.quantity`);
      if (cell) cell.textContent = `${row.quantity} ×`;
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
          const targetName = row.target;
          const target = TARGET_NAMES.includes(targetName) ? targets[targetName] : null;
          const remaining = [];
          for (const sourceEntry of row.sources) {
            try {
              if (!target) throw new Error("Der ausgewählte Target-Actor existiert nicht.");
              const source = await resolveSourceActor(sourceEntry.sourceUuid);
              const item = source?.items.get(sourceEntry.itemId);
              const quantity = Math.min(Number(sourceEntry.quantity), Number(item?.quantity ?? item?.system?.quantity ?? 0));
              if (!source || !item || !isPhysicalItem(item) || quantity < 1) {
                console.warn(`${PREFIX} Eine nicht mehr vorhandene Stack-Quelle ${sourceEntry.itemId} wurde verworfen.`);
                continue;
              }
              await synchronizeIdentificationStatus(item, row);
              await transferPhysicalItem(source, target, item, quantity);
            } catch (error) {
              remaining.push(sourceEntry);
              failures += 1;
              notifyError(`„${row.displayName}“ konnte nicht nach „${targetName ?? "unbekannt"}“ übertragen werden.`, error);
            }
          }
          row.sources = remaining;
          this._refreshRowQuantity(row);
          if (!row.sources.length || row.quantity < 1) this._removeRow(key);
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
        modal: false,
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
    for (const row of rows.values()) row.dialog = dialog;
  }

  function getIdentificationOutcome(message) {
    const outcome = message.flags?.pf2e?.context?.outcome;
    if (["criticalFailure", "failure", "success", "criticalSuccess"].includes(outcome)) return outcome;
    const degree = message.rolls?.find((roll) => Number.isInteger(roll.degreeOfSuccess))?.degreeOfSuccess;
    return ["criticalFailure", "failure", "success", "criticalSuccess"][degree] ?? null;
  }

  function getIdentificationFlagFromRoll(message) {
    const options = message.flags?.pf2e?.context?.options;
    const option = Array.isArray(options)
      ? options.find((value) => String(value).startsWith(IDENTIFICATION_OPTION_PREFIX))
      : null;
    const checkId = option?.slice(IDENTIFICATION_OPTION_PREFIX.length);
    if (!checkId) return null;
    return game.messages.find((candidate) => {
      const flag = candidate.flags?.[MODULE_ID];
      return flag?.action === "identify" && flag.checkId === checkId;
    })?.flags?.[MODULE_ID] ?? null;
  }

  async function identifyFromRoll(message) {
    const activeGM = game.users.activeGM;
    if (!game.user.isGM || (activeGM && activeGM.id !== game.user.id)) return;
    if (!["success", "criticalSuccess"].includes(getIdentificationOutcome(message))) return;
    const flag = getIdentificationFlagFromRoll(message);
    const row = flag ? openLootRows.get(flag.rowKey) : null;
    if (!row || row.quicklootIdentified || row.checkId !== flag.checkId) return;

    row.quicklootIdentified = true;
    const entries = [];
    for (const sourceEntry of row.sources) {
      const source = await resolveSourceActor(sourceEntry.sourceUuid);
      const item = source?.items.get(sourceEntry.itemId);
      if (item && isPhysicalItem(item)) entries.push({ source: sourceEntry, item });
    }
    const representativeItem = entries[0]?.item;
    for (const entry of entries) {
      if (typeof entry.item.setIdentificationStatus !== "function") continue;
      try {
        await entry.item.setIdentificationStatus("identified");
      } catch (error) {
        console.warn(`${PREFIX} Ein Source-Item des Stacks konnte nicht persistent identifiziert werden.`, error);
      }
    }

    if (!representativeItem) {
      row.dialog?._removeRow(row.key);
      return;
    }
    row.displayName = representativeItem.name;
    row.displayImg = representativeItem.img;
    row.dialog?.revealRow(row.key);

    try {
      await postItemToChat(representativeItem, row);
    } catch (error) {
      console.error(`${PREFIX} Der automatisch identifizierte Gegenstand konnte nicht in den Chat gepostet werden.`, error);
      ui.notifications.warn(`${PREFIX} Der Gegenstand wurde identifiziert, aber der automatische Chat-Post ist fehlgeschlagen.`);
    }
  }

  Hooks.on("createChatMessage", (message) => void identifyFromRoll(message));
  Hooks.on("updateChatMessage", (message) => void identifyFromRoll(message));

  Hooks.on("deleteCombat", (combat) => void showLootDialog(combat).catch((error) => {
    notifyError("Der Loot-Dialog konnte nicht geöffnet werden.", error);
  }));

  const namespace = (game.pf2eCombatQuickloot ??= {});
  Object.assign(namespace, {
    getIdentificationChecks,
    getLootStackKey,
    getIdentificationBaseDC,
    getIdentificationRarityModifier,
    getMagicTraditions,
    getSafeItemDisplayData,
    getMystifiedDisplayData,
    collectLoot,
    isQuicklootMystifiable,
    createPublicChatMessage,
    postItemToChat,
    postIdentificationChecks,
    resolveTargetActors,
    showLootDialog,
  });
})();
