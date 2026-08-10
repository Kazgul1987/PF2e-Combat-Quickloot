(() => {
  "use strict";

  async function showInventoryDialog() {
    const token = canvas.tokens.controlled[0];
    if (!token?.actor) return ui.notifications.warn("Bitte zuerst einen Token auswählen.");

    const actor = token.actor;
    const rows = actor.items
      .filter((item) => item.isPhysical === true)
      .map((item) => {
        const identified = item.isIdentified ?? item.system?.identification?.status === "identified";
        const name = identified
          ? item.name
          : item.getMystifiedName?.() ?? item.getMystifiedData?.("unidentified")?.name ?? "Unidentifizierter Gegenstand";
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
