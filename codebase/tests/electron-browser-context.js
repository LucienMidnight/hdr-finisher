const fs = require("node:fs");

// Playwright contexts are sequential here: each uses the runner's one window.
// CDP supplies real renderer scaling and removable init scripts. Closing a
// logical context releases its state without closing the app for the next one.
function installSequentialContexts(browser, page, navigate, origin) {
  let active = null;
  let directCdp = null;
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (options = {}) => {
    const result = await newPage(options);
    if (!active && options.deviceScaleFactor !== undefined) {
      directCdp ||= await page.context().newCDPSession(page);
      const size = options.viewport || await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      await directCdp.send("Emulation.setDeviceMetricsOverride", {
        width: size.width, height: size.height,
        deviceScaleFactor: options.deviceScaleFactor, mobile: false,
      });
    } else if (!active && directCdp) {
      await directCdp.send("Emulation.clearDeviceMetricsOverride");
    }
    return result;
  };
  browser.newContext = async (options = {}) => {
    if (active) throw new Error("Electron runner supports one browser context at a time");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Page.enable");
    const scripts = [];
    const originalAddInitScript = page.addInitScript;
    const listeners = new Map(page.eventNames().map(name => [name, new Set(page.listeners(name))]));
    await navigate("about:blank");
    await cdp.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
    await page.context().clearCookies();
    const addInitScript = async (script, arg) => {
      const source = typeof script === "function"
        ? `(${script.toString()})(${arg === undefined ? "undefined" : JSON.stringify(arg)})`
        : typeof script === "string" ? script
          : script.path ? fs.readFileSync(script.path, "utf8") : script.content;
      const result = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source });
      scripts.push(result.identifier);
    };
    page.addInitScript = addInitScript;
    let pageCreated = false;
    const context = {
      addInitScript,
      newPage: async () => {
        if (pageCreated) throw new Error("Electron runner supports one page per context");
        pageCreated = true;
        await browser.newPage(options);
        if (options.deviceScaleFactor !== undefined) {
          const size = options.viewport || await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
          await cdp.send("Emulation.setDeviceMetricsOverride", {
            width: size.width, height: size.height,
            deviceScaleFactor: options.deviceScaleFactor, mobile: false,
          });
        }
        return page;
      },
      pages: () => pageCreated ? [page] : [],
      close: async () => {
        if (active !== context) return;
        await navigate("about:blank");
        for (const identifier of scripts) await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
        await cdp.send("Emulation.clearDeviceMetricsOverride");
        await page.unrouteAll({ behavior: "wait" });
        for (const name of page.eventNames()) {
          for (const listener of page.listeners(name)) {
            if (!listeners.get(name)?.has(listener)) page.removeListener(name, listener);
          }
        }
        page.addInitScript = originalAddInitScript;
        await cdp.detach();
        active = null;
      },
    };
    active = context;
    return context;
  };
  browser.contexts = () => active ? [active] : [];
}

module.exports = { installSequentialContexts };
