(() => {
  "use strict";

  function isPhysicalItem(item) {
    return item?.isOfType?.("physical") === true;
  }

  async function showInventoryDialog() {
    const token = canvas.tokens.controlled[0];
    if (!token?.actor) return ui.notifications.warn("Bitte zuerst einen Token auswählen.");

    const actor = token.actor;
    const rows = actor.items
      .filter((item) => isPhysicalItem(item))
      .map((item) => {
        const { name } = game.pf2eCombatQuickloot.getSafeItemDisplayData(item);
        return `<tr><td>${Number(item.quantity ?? 1)} × ${foundry.utils.escapeHTML(name)}</td></tr>`;
      })
      .join("");

    return foundry.applications.api.DialogV2.wait({
      window: { title: `Inventar von ${actor.name}` },
      content: `<table class="quickloot inventory"><tbody>${rows || "<tr><td>Keine Items.</td></tr>"}</tbody></table>`,
      buttons: [{ action: "close", label: "Schließen", icon: "fa-solid fa-xmark", default: true }],
    });
  }

  Hooks.once("ready", () => {
    const namespace = (game.pf2eCombatQuickloot ??= {});
    namespace.showInventoryDialog = showInventoryDialog;
  });
})();
