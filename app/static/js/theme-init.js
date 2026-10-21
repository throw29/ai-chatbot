// Apply theme and choose the first screen before first paint to avoid a flash.
(function () {
  "use strict";
  try {
    var savedTheme = localStorage.getItem("aurora.theme.v1");
    var prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    document.documentElement.dataset.theme =
      savedTheme === "light" || (!savedTheme && prefersLight) ? "light" : "dark";

    var rawPersona = localStorage.getItem("aurora.persona.v1");
    var persona = rawPersona ? JSON.parse(rawPersona) : null;
    var hasPersona = Boolean(
      persona &&
        typeof persona.name === "string" &&
        persona.name.trim() &&
        typeof persona.personality === "string" &&
        persona.personality
    );
    document.documentElement.dataset.view = hasPersona ? "chat" : "setup";
  } catch (error) {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.view = "setup";
  }
})();
