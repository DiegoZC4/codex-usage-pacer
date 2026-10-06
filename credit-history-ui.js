(() => {
  "use strict";
  const core = globalThis.CodexUsageCreditHistoryCore;
  const resetCore = globalThis.CodexUsageResetLogCore;
  const ROOT_CLASS = "codex-usage-pacer-credit-history";
  const RANGE_KEY = "codexUsagePacerCreditHistoryRangeV1";
  const number = (value) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const stamp = (atMs) => new Date(atMs).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit",
  });
  const svgNode = (name, attributes = {}, text = "") => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text) node.textContent = text;
    return node;
  };

  globalThis.createCodexCreditHistoryUI = ({ setTooltip, showTooltip, hideTooltip, handleError }) => {
    const roots = new Map();
    let range = "24h";
    let destroyed = false;
    const resizer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const state = roots.get(entry.target);
        if (state && Math.round(entry.contentRect.width) !== state.width) draw(entry.target, state);
      }
    });

    function redraw() { for (const [root, state] of roots) draw(root, state); }
    function storageChanged(changes, area) {
      const value = changes[RANGE_KEY]?.newValue;
      if (!destroyed && area === "local" && Object.hasOwn(core.RANGES, value) && range !== value) {
        range = value;
        redraw();
      }
    }
    async function load() {
      try {
        const stored = await chrome.storage.local.get(RANGE_KEY);
        if (destroyed) return;
        if (Object.hasOwn(core.RANGES, stored?.[RANGE_KEY])) range = stored[RANGE_KEY];
        chrome.storage.onChanged?.addListener(storageChanged);
        redraw();
      } catch (error) { handleError("load credit history preferences from", error); }
    }

    function draw(root, state) {
      if (destroyed) return;
      state.width = Math.round(root.getBoundingClientRect().width);
      const view = core.buildView(state.history, range);
      state.view = view;
      for (const button of root.querySelectorAll("[data-range]")) {
        button.setAttribute("aria-pressed", String(button.dataset.range === range));
      }
      const rate = root.querySelector(".codex-credit-history-rate");
      rate.textContent = view.dailyDecline === null ? "Daily decline: pending" : `${number(view.dailyDecline)} credits/day decline (est.)`;
      setTooltip(rate, view.dailyDecline === null ? "Two valid, consecutive balance observations are needed to estimate a rate."
        : `Observed decreases: ${number(view.decline)} credits\nObserved increases: ${number(view.increases)} credits (separate from decreases)\n${stamp(view.statsStartAtMs)} to ${stamp(view.statsEndAtMs)}\n${number(view.coveredMs / 3_600_000)} hours between valid observations.\nDecreases may include spending, expirations, or adjustments. Changes crossing the selected range boundary and missing-balance intervals are excluded. Unseen debits and top-ups between checks cannot be separated.`);
      const summary = root.querySelector(".codex-credit-history-summary");
      summary.textContent = `${number(view.observedDecline)} decrease / +${number(view.observedIncreases)} increase`;
      setTooltip(summary, "Changes between recorded balances, including across missing-balance intervals. Increases may be grants, purchases, or adjustments. The daily rate excludes intervals containing a missing balance.");
      const updated = root.querySelector(".codex-credit-history-updated");
      updated.textContent = view.lastCheckedAtMs === null ? "No recorded credit checks" : `Last checked ${stamp(view.lastCheckedAtMs)}`;
      const plot = root.querySelector(".codex-credit-history-plot");
      const empty = root.querySelector(".codex-credit-history-empty");
      empty.hidden = view.validPoints.length > 0;
      empty.textContent = "No credit balances recorded in this range.";
      plot.hidden = !view.validPoints.length;
      if (!view.validPoints.length) return;

      const width = Math.max(200, state.width);
      const left = 56, right = width - 10, top = 10, bottom = 160;
      const endAtMs = Math.max(view.startAtMs + 60_000, view.endAtMs);
      const scale = core.yScale(view.validPoints);
      const x = (atMs) => left + (atMs - view.startAtMs) / (endAtMs - view.startAtMs) * (right - left);
      const y = (count) => bottom - (count - scale.min) / (scale.max - scale.min) * (bottom - top);
      const svg = svgNode("svg", { viewBox: `0 0 ${width} 194`, "aria-hidden": "true" });
      for (const tick of scale.ticks) {
        svg.append(svgNode("line", { x1: left, x2: right, y1: y(tick), y2: y(tick), class: "codex-credit-history-grid" }));
        const label = tick.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 });
        svg.append(svgNode("text", { x: left - 8, y: y(tick) + 3, "text-anchor": "end" }, label));
      }
      const tickCount = width < 400 ? 3 : 5;
      for (let index = 0; index < tickCount; index += 1) {
        const atMs = view.startAtMs + (endAtMs - view.startAtMs) * index / (tickCount - 1);
        const date = new Date(atMs);
        const label = endAtMs - view.startAtMs <= core.DAY_MS ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
          : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        svg.append(svgNode("text", { x: x(atMs), y: 183, "text-anchor": index === 0 ? "start" : index === tickCount - 1 ? "end" : "middle" }, label));
      }
      const byTime = new Map(view.changes.map((change) => [change.to.atMs, change]));
      // Coalesce ordinary lines; point inspection retains every saved observation.
      for (const stale of [false, true]) {
        const d = view.segments.filter((segment) => segment.stale === stale).map(({ from, to }) =>
          `M${x(from.atMs)},${y(from.count)}L${x(to.atMs)},${y(to.count)}`).join("");
        svg.append(svgNode("path", { d, class: "codex-credit-history-line", "data-stale": stale }));
      }
      for (const point of view.validPoints) {
        const increase = byTime.get(point.atMs)?.delta > 0;
        svg.append(svgNode("circle", { cx: x(point.atMs), cy: y(point.count), r: increase ? 4 : 2,
          class: "codex-credit-history-point", "data-increase": increase }));
      }
      const crosshair = svgNode("line", { y1: top, y2: bottom, class: "codex-credit-history-crosshair", visibility: "hidden" });
      const selectedDot = svgNode("circle", { r: 5, class: "codex-credit-history-selected", visibility: "hidden" });
      svg.append(crosshair, selectedDot);
      plot.replaceChildren(svg);
      plot.setAttribute("aria-valuemin", "0");
      plot.setAttribute("aria-valuemax", String(view.validPoints.length - 1));
      state.index = Math.min(state.index ?? view.validPoints.length - 1, view.validPoints.length - 1);
      const inspect = (index, clientX, clientY, reveal = true) => {
        state.index = index;
        const point = view.validPoints[index];
        const segment = byTime.get(point.atMs);
        const percent = resetCore.estimateCreditWeeklyPercent(point.count);
        const detail = [stamp(point.atMs), `${number(point.count)} credits / ~${number(percent)}% of a week`];
        if (segment) detail.push(`${segment.delta > 0 ? "+" : ""}${number(segment.delta)} credits since ${stamp(segment.from.atMs)}`);
        detail.push("Change occurred between checks; exact time and cause are unknown.");
        plot.setAttribute("aria-valuenow", String(index));
        plot.setAttribute("aria-valuetext", `${stamp(point.atMs)}: ${number(point.count)} credits`);
        setTooltip(plot, detail.join("\n"));
        crosshair.setAttribute("x1", x(point.atMs)); crosshair.setAttribute("x2", x(point.atMs));
        selectedDot.setAttribute("cx", x(point.atMs)); selectedDot.setAttribute("cy", y(point.count));
        crosshair.setAttribute("visibility", reveal ? "visible" : "hidden");
        selectedDot.setAttribute("visibility", reveal ? "visible" : "hidden");
        if (reveal) showTooltip(plot, clientX, clientY);
      };
      inspect(state.index, 0, 0, false);
      const pointer = (event) => {
        const bounds = plot.getBoundingClientRect();
        const position = (event.clientX - bounds.left) * width / bounds.width;
        let nearest = 0;
        for (let index = 1; index < view.validPoints.length; index += 1) {
          if (Math.abs(x(view.validPoints[index].atMs) - position) < Math.abs(x(view.validPoints[nearest].atMs) - position)) nearest = index;
        }
        inspect(nearest, event.clientX, event.clientY);
      };
      plot.onpointermove = pointer;
      plot.onpointerdown = pointer;
      plot.onpointerleave = plot.onblur = () => {
        crosshair.setAttribute("visibility", "hidden"); selectedDot.setAttribute("visibility", "hidden"); hideTooltip();
      };
      plot.onkeydown = (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = event.key === "Home" ? 0 : event.key === "End" ? view.validPoints.length - 1
          : Math.max(0, Math.min(view.validPoints.length - 1, state.index + (event.key === "ArrowRight" ? 1 : -1)));
        const bounds = plot.getBoundingClientRect();
        inspect(index, bounds.left + x(view.validPoints[index].atMs), bounds.top + y(view.validPoints[index].count));
      };
    }

    function render(card, history) {
      if (destroyed) return;
      for (const [root, state] of roots) {
        if (!root.isConnected || !state.card.isConnected) { resizer.unobserve(root); root.remove(); roots.delete(root); }
      }
      let root = [...roots].find(([, state]) => state.card === card)?.[0];
      if (!root) {
        root = document.createElement("section");
        root.className = ROOT_CLASS;
        root.setAttribute("data-codex-usage-pacer", "true");
        root.setAttribute("aria-label", "Credit balance history");
        root.innerHTML = '<div class="codex-credit-history-heading"><h4>Credit balance</h4><div class="codex-credit-history-ranges" role="group" aria-label="Credit history range"></div></div><div class="codex-credit-history-stats"><span class="codex-credit-history-rate"></span><span class="codex-credit-history-summary"></span></div><div class="codex-credit-history-plot" role="slider" tabindex="0" aria-label="Credit balance observations" aria-orientation="horizontal"></div><p class="codex-credit-history-empty" hidden></p><p class="codex-credit-history-updated"></p>';
        for (const value of Object.keys(core.RANGES)) {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.range = value;
          button.textContent = value === "all" ? "All" : value;
          button.addEventListener("click", () => {
            range = value;
            redraw();
            chrome.storage.local.set({ [RANGE_KEY]: range }).catch((error) => handleError("save credit history preferences to", error));
          });
          root.querySelector(".codex-credit-history-ranges").append(button);
        }
        card.parentElement.append(root);
        roots.set(root, { card, history, width: 0 });
        resizer.observe(root);
      }
      const state = roots.get(root);
      if (state.history !== history || !state.width) {
        state.history = history;
        draw(root, state);
      }
    }

    return { load, render, destroy() {
      destroyed = true;
      resizer.disconnect();
      try { chrome.storage.onChanged?.removeListener(storageChanged); } catch { /* Retired context. */ }
      for (const [root] of roots) root.remove();
      roots.clear();
    } };
  };
})();
