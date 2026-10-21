/* Shared backend preference: workers see changes without restarting the app. */
(() => {
  "use strict";
  const input = document.getElementById("settings-force-cpu-delivery");
  const status = document.getElementById("settings-delivery-status");
  async function request(body) {
    const response = await fetch("/api/delivery/preferences", body === undefined ? {} : {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.detail || "Delivery settings could not be saved.");
    return value;
  }
  function render(value) {
    input.checked = value.effective_force_cpu;
    input.disabled = value.environment_override;
    status.textContent = value.environment_override
      ? "CPU forced by HDR_FINISHER_FORCE_CPU_DELIVERY. Restart without that variable to use the setting."
      : value.force_cpu ? "CPU forced for new delivery work. Grade preview keeps its rendering mode."
      : "GPU delivery is not implemented yet; delivery currently uses the CPU.";
  }
  async function refresh() {
    try { render(await request()); }
    catch (error) { input.disabled = true; status.textContent = error.message; }
  }
  input.addEventListener("change", async () => {
    input.disabled = true;
    try { render(await request({force_cpu: input.checked})); }
    catch (error) { await refresh(); status.textContent = error.message; }
  });
  window.HDRDeliverySettings = Object.freeze({refresh});
  void refresh();
})();
