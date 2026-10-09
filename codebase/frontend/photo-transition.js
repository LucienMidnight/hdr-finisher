(function (root) {
  "use strict";

  // One policy for replacing/ejecting a photo and closing/quitting the app.
  // Windows session-end is synchronous: preserve its existing block-and-save
  // behavior instead of attempting an asynchronous save during OS shutdown.
  function leaveCurrentPhoto({ dirty = false, systemExit = false, choose, save } = {}) {
    if (!dirty) return true;
    if (systemExit) return false;
    return (async () => {
      const choice = await choose();
      if (choice === "discard") return true;
      if (choice === "save") return (await save()) === true;
      return false;
    })();
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { leaveCurrentPhoto };
  if (root) root.HDRPhotoTransition = Object.freeze({ leaveCurrentPhoto });
})(typeof window !== "undefined" ? window : null);
