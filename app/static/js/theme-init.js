// Apply the saved theme before first paint to avoid a flash.
(function () {
  "use strict";
  try {
    var saved = localStorage.getItem("aurora.theme.v1");
    var prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    document.documentElement.dataset.theme =
      saved === "light" || (!saved && prefersLight) ? "light" : "dark";
  } catch (error) {
    document.documentElement.dataset.theme = "dark";
  }
})();
