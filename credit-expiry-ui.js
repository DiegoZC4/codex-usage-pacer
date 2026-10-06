(() => {
  "use strict";
  const core = globalThis.CodexUsageCreditExpiryCore;
  const resetCore = globalThis.CodexUsageResetLogCore;
  const ROOT_CLASS = "codex-usage-pacer-credit-expirations";
  const MANAGED_ATTR = "data-codex-usage-pacer";
  const number = (value) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const dateLabel = (value) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
  const dateInput = (atMs) => {
    const date = new Date(atMs);
    return new Date(atMs - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  // Lucide icons (ISC): pencil and trash-2. No external assets or requests.
  const icons = {
    edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    remove: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>',
  };

  globalThis.createCodexCreditExpiryUI = ({ schedule, setTooltip, handleError }) => {
    let config = core.normalizeConfig(null);
    let ready = false;
    let destroyed = false;
    let latest = null;
    const roots = new Set();

    function iconButton(kind, label) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "codex-credit-icon";
      button.setAttribute("aria-label", label);
      setTooltip(button, label);
      button.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[kind]}</svg>`;
      return button;
    }

    async function save(next) {
      const normalized = core.normalizeConfig(next);
      await chrome.storage.local.set({ [core.STORAGE_KEY]: normalized });
      config = normalized;
      schedule();
    }

    function storageChanged(changes, area) {
      if (destroyed || area !== "local" || !changes[core.STORAGE_KEY]) return;
      config = core.normalizeConfig(changes[core.STORAGE_KEY].newValue);
      schedule();
    }

    async function load() {
      try {
        const stored = await chrome.storage.local.get(core.STORAGE_KEY);
        if (destroyed) return;
        config = core.normalizeConfig(stored?.[core.STORAGE_KEY]);
        ready = true;
        chrome.storage.onChanged?.addListener(storageChanged);
        schedule();
      } catch (error) { handleError("load credit expirations from", error); }
    }

    function showEditor(root, editing = null) {
      const panel = root.querySelector(".codex-credit-editor");
      panel.hidden = false;
      root.querySelector('[aria-label="Manage credit expirations"]').setAttribute("aria-expanded", "true");
      panel.replaceChildren();
      const list = document.createElement("div");
      list.className = "codex-credit-grant-list";
      for (const grant of config.grants) {
        const row = document.createElement("div");
        row.className = "codex-credit-grant";
        const label = document.createElement("span");
        label.textContent = `${grant.label} / ${dateLabel(grant.expiresOn)}`;
        const edit = iconButton("edit", `Edit ${grant.label}`);
        edit.addEventListener("click", () => showEditor(root, grant));
        const remove = iconButton("remove", `Remove ${grant.label}`);
        remove.addEventListener("click", async () => {
          remove.disabled = true;
          try {
            await save({ grants: config.grants.filter((item) => item.id !== grant.id) });
            showEditor(root);
          } catch (error) {
            remove.disabled = false;
            status.textContent = "Could not save expiration changes.";
            handleError("save credit expirations to", error);
          }
        });
        row.append(label, edit, remove);
        list.append(row);
      }
      panel.append(list);

      const form = document.createElement("form");
      form.className = "codex-credit-form";
      form.innerHTML = `
        <label>Label<input name="label" aria-label="Credit bucket label" required maxlength="100"></label>
        <label>Entry type<select name="kind" aria-label="Credit entry type"><option value="grant">New credits received</option><option value="allocation">Date existing undated credits</option></select></label>
        <label class="codex-credit-history-field">Recorded balance increase<select name="observation" aria-label="Recorded credit increase"><option value="">Custom date and time</option></select></label>
        <label>Credits<input name="amount" aria-label="Credits in bucket" type="number" min="0.000001" step="any" required></label>
        <label>Observed at<input name="at" aria-label="Credit observation time" type="datetime-local" required></label>
        <label>Expiration date<input name="expires" aria-label="Credit expiration date" type="date" required></label>
        <label class="codex-credit-source-field">Source (optional)<input name="source" aria-label="Credit expiration source" type="url" placeholder="https://"></label>
        <div class="codex-credit-form-actions"><button type="submit">Save</button><button type="button" data-action="cancel">Cancel</button></div>
        <p class="codex-credit-form-status" role="status"></p>`;
      panel.append(form);
      const fields = form.elements;
      const status = form.querySelector('[role="status"]');
      const increases = core.balanceIncreases(latest.observations);
      for (const point of increases) {
        const option = document.createElement("option");
        option.value = String(point.atMs);
        option.textContent = `${new Date(point.atMs).toLocaleString()} (+${number(point.amount)})`;
        fields.observation.append(option);
      }
      const suggested = increases.find((point) => !config.grants.some((grant) => grant.observedAtMs === point.atMs));
      fields.kind.value = editing?.kind || "grant";
      fields.label.value = editing?.label || "";
      fields.amount.value = editing?.amount ?? suggested?.amount ?? "";
      let preciseAtMs = editing?.observedAtMs ?? suggested?.atMs ?? latest.atMs;
      fields.at.value = dateInput(preciseAtMs);
      fields.expires.value = editing?.expiresOn || "";
      fields.source.value = editing?.sourceUrl || "";
      const selectedTime = editing?.observedAtMs ?? suggested?.atMs;
      if (increases.some((point) => point.atMs === selectedTime)) fields.observation.value = String(selectedTime);
      fields.observation.addEventListener("change", () => {
        const selected = increases.find((point) => point.atMs === Number(fields.observation.value));
        if (!selected) return;
        preciseAtMs = selected.atMs;
        fields.at.value = dateInput(selected.atMs);
        fields.amount.value = selected.amount;
      });
      fields.at.addEventListener("input", () => { fields.observation.value = ""; preciseAtMs = null; });
      const updateKind = () => {
        const allocation = fields.kind.value === "allocation";
        form.querySelector(".codex-credit-history-field").hidden = allocation;
        if (allocation) {
          fields.observation.value = "";
          preciseAtMs = latest.atMs;
          fields.at.value = dateInput(latest.atMs);
        }
      };
      fields.kind.addEventListener("change", updateKind);
      if (fields.kind.value === "allocation") form.querySelector(".codex-credit-history-field").hidden = true;
      const close = () => {
        panel.hidden = true;
        root.querySelector('[aria-label="Manage credit expirations"]').setAttribute("aria-expanded", "false");
        schedule();
      };
      form.querySelector('[data-action="cancel"]').addEventListener("click", close);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const value = core.normalizeGrant({
          id: editing?.id || crypto.randomUUID(), label: fields.label.value,
          amount: Number(fields.amount.value), expiresOn: fields.expires.value,
          observedAtMs: fields.observation.value ? Number(fields.observation.value)
            : preciseAtMs !== null && dateInput(preciseAtMs) === fields.at.value ? preciseAtMs
              : new Date(fields.at.value).getTime(),
          sourceUrl: fields.source.value, kind: fields.kind.value,
        });
        if (!value || value.observedAtMs > Date.now() || (fields.source.value && !value.sourceUrl)) {
          status.textContent = "Check the amount, dates, and HTTPS source link.";
          return;
        }
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
          await save({ grants: [...config.grants.filter((item) => item.id !== value.id), value] });
          close();
        } catch (error) {
          submit.disabled = false;
          status.textContent = "Could not save expiration changes.";
          handleError("save credit expirations to", error);
        }
      });
    }

    function render(card, count, history) {
      if (destroyed || !ready || !Number.isFinite(count)) return;
      const atMs = Date.now();
      const observations = core.observationsFromHistory(history, { atMs, count });
      latest = { atMs, observations };
      const view = core.estimateBuckets(config, observations, atMs);
      let root = card.querySelector(`.${ROOT_CLASS}`);
      if (!root) {
        root = document.createElement("section");
        root.className = ROOT_CLASS;
        root.setAttribute(MANAGED_ATTR, "true");
        root.setAttribute("aria-label", "Credits by expiration date");
        root.innerHTML = '<div class="codex-credit-heading"><h4>Credit expirations</h4></div><table aria-label="Estimated credit expiration buckets"><thead><tr><th>Expires</th><th>Week (est.)</th><th>Credits</th></tr></thead><tbody></tbody></table><p class="codex-credit-basis"></p><div class="codex-credit-editor" hidden></div>';
        const edit = iconButton("edit", "Manage credit expirations");
        edit.setAttribute("aria-expanded", "false");
        edit.addEventListener("click", () => {
          const panel = root.querySelector(".codex-credit-editor");
          if (panel.hidden) showEditor(root);
          else { panel.hidden = true; edit.setAttribute("aria-expanded", "false"); }
        });
        root.querySelector(".codex-credit-heading").append(edit);
        roots.add(root);
        card.append(root);
      }
      const rows = document.createDocumentFragment();
      for (const bucket of view.buckets) {
        const row = document.createElement("tr");
        const date = document.createElement("th");
        date.scope = "row";
        const sourceUrls = [...new Set(bucket.grants.map((grant) => grant.sourceUrl).filter(Boolean))];
        const label = document.createElement(sourceUrls.length === 1 ? "a" : "span");
        label.textContent = bucket.expiresOn ? dateLabel(bucket.expiresOn) : "Date unknown";
        if (sourceUrls.length === 1) {
          label.href = sourceUrls[0]; label.target = "_blank"; label.rel = "noopener noreferrer";
        }
        const details = bucket.grants.map((grant) => `${grant.label}: ~${number(grant.remaining)} credits`).join("\n");
        const past = bucket.expiresOn && bucket.expiresOn < dateInput(atMs).slice(0, 10);
        setTooltip(label, bucket.expiresOn
          ? `${details}\nEstimated remaining balance, earliest-expiry-first allocation.\nExpiration date only; exact cutoff time and timezone not supplied.${past ? "\nDate has passed; allocation needs review." : ""}`
          : "Credits without a recorded expiration date. These may include purchases or other grants. They are not assumed to never expire.");
        date.append(label);
        const percent = document.createElement("td");
        const value = resetCore.estimateCreditWeeklyPercent(bucket.remaining);
        percent.textContent = value > 0 && value < 0.1 ? "<0.1%" : `~${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
        const credits = document.createElement("td");
        credits.textContent = number(bucket.remaining);
        if (past) row.dataset.expired = "true";
        row.append(date, percent, credits);
        rows.append(row);
      }
      root.querySelector("tbody").replaceChildren(rows);
      const basis = root.querySelector(".codex-credit-basis");
      basis.textContent = `Estimated split; dated credits spent first. ${number(resetCore.PROVISIONAL_WEEKLY_CREDITS)} credits/week.`;
      if (view.historyMissing) basis.textContent += "; incomplete grant history";
      if (view.overflow) basis.textContent += "; allocation exceeds undated balance";
      setTooltip(basis, "Only the total is reported by OpenAI. Dated grants are debited in expiry order; undated credits last. New unexplained increases remain undated. This assumption may differ from OpenAI's allocation. Percentages use the provisional Pro 20x estimate and do not affect pacing.");
    }

    return {
      load, render,
      destroy() {
        destroyed = true;
        try { chrome.storage.onChanged?.removeListener(storageChanged); } catch { /* Retired context. */ }
        for (const root of roots) root.remove();
      },
    };
  };
})();
