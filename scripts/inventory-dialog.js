// Inventar-Dialog anzeigen
function showInventoryDialog() {
  const token = canvas.tokens.controlled[0];
  if (!token) return ui.notifications.warn("Bitte zuerst einen Token auswählen.");

  const actor = token.actor;
  const items = actor.items.filter(i => i.isPhysical);
  const rows = items
    .map(
      i =>
        `<tr data-id="${i.id}">
           <td class="item-link">${i.quantity ?? 1} × ${TextEditor.encodeHTML(i.name)}</td>
         </tr>`
    )
    .join("");

  new Dialog({
    title: `Inventar von ${actor.name}`,
    content: `<form><table class="quickloot">${
      rows || "<tr><td>Keine Items.</td></tr>"
    }</table></form>`,
    buttons: { close: { label: "Schließen" } },
    render: html => {
      html.find(".item-link").click(ev => {
        const id = ev.currentTarget.closest("tr").dataset.id;
        actor.items.get(id)?.sheet.render(true);
      });
    }
  }).render(true);
}

Hooks.once("ready", () => {
  game.pf2eCombatQuickloot = game.pf2eCombatQuickloot || {};
  game.pf2eCombatQuickloot.showInventoryDialog = showInventoryDialog;
});
