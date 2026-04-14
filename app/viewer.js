var CFG = {
  bg: "#171c25",
  text: "#f2f3f5",
  grid: "#2d3646",
  call: "#2C7FB8",
  put: "#F03B20",
  net: "#1B9E77",
  spot: "#FF8C00",
  flip: "#111111",
  front: "#27ae60",
  core: "#2980b9",
  medium: "#f39c12",
};

var TAB_HINTS = {
  levels:
    "Levels Map: bars are call/put gamma by strike, and green line is net gamma. Use spot/call wall/put wall/flip vertical lines as your key levels.",
  flip:
    "Flip Map: net gamma curve across hypothetical spot prices. Above zero means positive-gamma zone, below zero means negative-gamma zone.",
  trend:
    "Trend: run-to-run net gamma history in your browser timezone. Hover points to read exact time and value.",
  buckets:
    "3 Buckets: compare Front/Core/Medium bucket net gamma line on the same strike axis.",
  oi:
    "Highest OI: top call/put contracts ranked by open interest. You can filter by expiration above.",
  heatmap:
    "Gamma Heatmap: strike on Y, run time on X, blue=positive gamma, red=negative gamma; black line is spot path.",
};

var state = {
  payload: null,
  symbol: null,
  bucket: "core",
  activeTab: "levels",
  selectedExpirations: [],
  expTouched: false,
  symbolOrder: [],
  dragSymbol: null,
};

var SYMBOL_ORDER_STORAGE_KEY = "gamma_dashboard_symbol_order_v1";

function toNum(val) {
  var n = Number(val);
  return isFinite(n) ? n : null;
}

function safeText(val) {
  if (val === null || val === undefined) return "";
  return String(val);
}

function fmtNum(val, digits) {
  var d = typeof digits === "number" ? digits : 2;
  var n = toNum(val);
  if (n === null) return "N/A";
  return n.toLocaleString(undefined, {
    maximumFractionDigits: d,
    minimumFractionDigits: d,
  });
}

function fmtBn(val) {
  var n = toNum(val);
  if (n === null) return "N/A";
  return (n / 1e9).toFixed(2) + " Bn";
}

function fmtInt(val) {
  var n = toNum(val);
  if (n === null) return "N/A";
  return Math.round(n).toLocaleString();
}

function fmtExp(val) {
  var raw = safeText(val).trim();
  if (!raw) return "-";
  try {
    var dt = new Date(raw + "T00:00:00");
    if (isNaN(dt.getTime())) return raw;
    var mm = String(dt.getMonth() + 1);
    if (mm.length < 2) mm = "0" + mm;
    var dd = String(dt.getDate());
    if (dd.length < 2) dd = "0" + dd;
    var yy = String(dt.getFullYear()).slice(-2);
    return mm + "/" + dd + "/" + yy;
  } catch (e) {
    return raw;
  }
}

function parseTime(val) {
  if (!val) return null;
  var dt = new Date(val);
  return isNaN(dt.getTime()) ? null : dt;
}

function baseLayout(titleX, titleY) {
  return {
    margin: { l: 64, r: 18, t: 20, b: 46 },
    xaxis: {
      title: titleX,
      gridcolor: CFG.grid,
      zeroline: true,
      zerolinecolor: "#7b8798",
      zerolinewidth: 1,
    },
    yaxis: {
      title: titleY,
      gridcolor: CFG.grid,
      zeroline: true,
      zerolinecolor: "#7b8798",
      zerolinewidth: 1,
    },
    dragmode: "pan",
    paper_bgcolor: CFG.bg,
    plot_bgcolor: CFG.bg,
    font: { color: CFG.text },
    legend: { orientation: "h" },
  };
}

var baseConfig = {
  responsive: true,
  displaylogo: false,
  scrollZoom: true,
  doubleClick: "reset",
};

function copyObj(src) {
  var out = {};
  if (!src) return out;
  for (var k in src) {
    if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
  }
  return out;
}

function uniqueSorted(arr) {
  var seen = {};
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var key = String(arr[i]);
    if (!seen[key]) {
      seen[key] = true;
      out.push(arr[i]);
    }
  }
  out.sort();
  return out;
}

function hasSelectedExp(exp) {
  return state.selectedExpirations.indexOf(exp) >= 0;
}

function addSelectedExp(exp) {
  if (!hasSelectedExp(exp)) state.selectedExpirations.push(exp);
}

function removeSelectedExp(exp) {
  var idx = state.selectedExpirations.indexOf(exp);
  if (idx >= 0) state.selectedExpirations.splice(idx, 1);
}

function setSelectedExpList(list) {
  state.selectedExpirations = list.slice();
}

function arrContains(arr, value) {
  return arr.indexOf(value) >= 0;
}

function loadStoredSymbolOrder() {
  try {
    if (typeof localStorage === "undefined") return [];
    var raw = localStorage.getItem(SYMBOL_ORDER_STORAGE_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    var out = [];
    for (var i = 0; i < parsed.length; i++) {
      var sym = safeText(parsed[i]).toUpperCase();
      if (sym && !arrContains(out, sym)) out.push(sym);
    }
    return out;
  } catch (e) {
    return [];
  }
}

function saveStoredSymbolOrder() {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SYMBOL_ORDER_STORAGE_KEY, JSON.stringify(state.symbolOrder || []));
  } catch (e) {
  }
}

function syncSymbolOrder(availableSymbols) {
  var available = availableSymbols.slice();
  var order = [];
  if (state.symbolOrder && state.symbolOrder.length) {
    order = state.symbolOrder.slice();
  } else {
    order = loadStoredSymbolOrder();
  }

  var next = [];
  for (var i = 0; i < order.length; i++) {
    if (arrContains(available, order[i]) && !arrContains(next, order[i])) next.push(order[i]);
  }
  for (var j = 0; j < available.length; j++) {
    if (!arrContains(next, available[j])) next.push(available[j]);
  }

  state.symbolOrder = next;
  saveStoredSymbolOrder();
  return next.slice();
}

function getSymbols() {
  var root = state.payload || {};
  var symbolsRaw = Array.isArray(root.symbols) ? root.symbols : [];
  var symbols = [];
  for (var i = 0; i < symbolsRaw.length; i++) {
    var sym = safeText(symbolsRaw[i].symbol).toUpperCase();
    if (sym) symbols.push(sym);
  }
  symbols.sort();
  return syncSymbolOrder(symbols);
}

function getSymbolEntry(sym) {
  var target = safeText(sym || state.symbol).toUpperCase();
  var root = state.payload || {};
  var symbols = Array.isArray(root.symbols) ? root.symbols : [];
  for (var i = 0; i < symbols.length; i++) {
    if (safeText(symbols[i].symbol).toUpperCase() === target) return symbols[i];
  }
  return null;
}

function getBucketData(symbolEntry, bucket) {
  var b = bucket || state.bucket;
  var buckets = symbolEntry && symbolEntry.buckets ? symbolEntry.buckets : {};
  if (buckets[b]) return buckets[b];
  if (buckets.core) return buckets.core;
  for (var k in buckets) {
    if (Object.prototype.hasOwnProperty.call(buckets, k)) return buckets[k];
  }
  return {};
}

function getMetric(symbolEntry, bucket) {
  var data = getBucketData(symbolEntry, bucket);
  return data && data.metric ? data.metric : {};
}

function getDefaultPriceRange(spot) {
  var s = toNum(spot);
  if (s === null || s <= 0) return null;
  return [s * 0.95, s * 1.05];
}

function sourceBadgeClass(source) {
  var src = safeText(source).toLowerCase();
  if (src.indexOf("ibkr") >= 0 && src.indexOf("yahoo") >= 0) return "mix";
  if (src.indexOf("ibkr") >= 0) return "ibkr";
  if (src.indexOf("yahoo") >= 0) return "yahoo";
  return "ibkr";
}

function sourceBadgeText(source) {
  var src = safeText(source).toLowerCase();
  if (src.indexOf("ibkr") >= 0 && src.indexOf("yahoo") >= 0) return "I+Y";
  if (src.indexOf("yahoo") >= 0) return "Y";
  if (src.indexOf("ibkr") >= 0) return "I";
  return "?";
}

function safePlot(targetId, traces, layout, config) {
  if (typeof Plotly === "undefined" || !Plotly.newPlot) {
    var meta = document.getElementById("metaLine");
    if (meta && meta.textContent.indexOf("Plotly") === -1) {
      meta.textContent = "UI loaded, but chart library failed to load (Plotly). Try refresh or switch network.";
    }
    return;
  }
  Plotly.newPlot(targetId, traces, layout, config);
}

function renderMeta() {
  var root = state.payload || {};
  var meta = root.meta || {};
  var finishedAt = parseTime(meta.finished_at);
  var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  var finishedText = finishedAt ? finishedAt.toLocaleString() : safeText(meta.finished_at || "-");
  var line = document.getElementById("metaLine");
  line.textContent =
    "Run #" + (meta.run_id || "-") +
    " | Last " + finishedText + " (" + tz + ")" +
    " | Success " + (meta.success_count || 0) +
    " | Failed " + (meta.failure_count || 0);
}

function renderSymbolSelect() {
  var symbols = getSymbols();
  var sel = document.getElementById("symbolSelect");
  var html = "";
  for (var i = 0; i < symbols.length; i++) {
    html += '<option value="' + symbols[i] + '">' + symbols[i] + "</option>";
  }
  sel.innerHTML = html;

  if (!state.symbol || symbols.indexOf(state.symbol) < 0) {
    state.symbol = symbols.length ? symbols[0] : null;
    state.selectedExpirations = [];
    state.expTouched = false;
  }
  sel.value = state.symbol || "";
}

function renderSnapshotTable() {
  var body = document.getElementById("snapshotBody");
  var symbols = getSymbols();
  var html = "";

  for (var i = 0; i < symbols.length; i++) {
    var sym = symbols[i];
    var entry = getSymbolEntry(sym);
    var metric = getMetric(entry, state.bucket);
    var source = entry ? entry.source : null;
    var badgeCls = sourceBadgeClass(source);
    var badgeText = sourceBadgeText(source);
    var activeCls = sym === state.symbol ? "active" : "";

    html +=
      '<tr data-symbol="' + sym + '" class="' + activeCls + '" draggable="true">' +
      '<td class="symbol-cell">' + sym + "</td>" +
      '<td><span class="badge ' + badgeCls + '" title="' + (safeText(source) || "unknown") + '">' + badgeText + "</span></td>" +
      "<td>" + fmtNum(metric.spot) + "</td>" +
      "<td>" + safeText(metric.sign || "N/A") + "</td>" +
      "<td>" + fmtBn(metric.net_gex) + "</td>" +
      "<td>" + fmtNum(metric.call_wall) + "</td>" +
      "<td>" + fmtNum(metric.put_wall) + "</td>" +
      "<td>" + fmtNum(metric.flip_price) + "</td>" +
      "</tr>";
  }

  body.innerHTML = html;

  var rows = body.querySelectorAll("tr[data-symbol]");
  function clearDragClasses() {
    var allRows = body.querySelectorAll("tr[data-symbol]");
    for (var idx = 0; idx < allRows.length; idx++) {
      allRows[idx].classList.remove("dragging");
      allRows[idx].classList.remove("drop-before");
      allRows[idx].classList.remove("drop-after");
    }
  }

  function reorderSymbols(dragSymbol, targetSymbol, insertAfter) {
    if (!dragSymbol || !targetSymbol || dragSymbol === targetSymbol) return;
    var order = getSymbols().slice();
    var fromIndex = order.indexOf(dragSymbol);
    var targetIndex = order.indexOf(targetSymbol);
    if (fromIndex < 0 || targetIndex < 0) return;

    order.splice(fromIndex, 1);
    if (fromIndex < targetIndex) targetIndex -= 1;
    if (insertAfter) targetIndex += 1;
    if (targetIndex < 0) targetIndex = 0;
    if (targetIndex > order.length) targetIndex = order.length;
    order.splice(targetIndex, 0, dragSymbol);

    state.symbolOrder = order.slice();
    saveStoredSymbolOrder();
    renderSymbolSelect();
    document.getElementById("symbolSelect").value = state.symbol || "";
    renderSnapshotTable();
  }

  for (var r = 0; r < rows.length; r++) {
    rows[r].addEventListener("click", function () {
      var symbol = safeText(this.getAttribute("data-symbol")).toUpperCase();
      state.symbol = symbol;
      state.selectedExpirations = [];
      state.expTouched = false;
      document.getElementById("symbolSelect").value = symbol;
      renderAll();
    });

    rows[r].addEventListener("dragstart", function (ev) {
      var symbol = safeText(this.getAttribute("data-symbol")).toUpperCase();
      state.dragSymbol = symbol;
      this.classList.add("dragging");
      if (ev.dataTransfer) {
        ev.dataTransfer.effectAllowed = "move";
        try {
          ev.dataTransfer.setData("text/plain", symbol);
        } catch (e) {
        }
      }
    });

    rows[r].addEventListener("dragover", function (ev) {
      if (!state.dragSymbol) return;
      var targetSymbol = safeText(this.getAttribute("data-symbol")).toUpperCase();
      if (!targetSymbol || targetSymbol === state.dragSymbol) return;
      ev.preventDefault();
      clearDragClasses();
      var rect = this.getBoundingClientRect();
      var isAfter = (ev.clientY - rect.top) > (rect.height / 2);
      this.classList.add(isAfter ? "drop-after" : "drop-before");
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    });

    rows[r].addEventListener("dragleave", function () {
      this.classList.remove("drop-before");
      this.classList.remove("drop-after");
    });

    rows[r].addEventListener("drop", function (ev) {
      if (!state.dragSymbol) return;
      ev.preventDefault();
      var targetSymbol = safeText(this.getAttribute("data-symbol")).toUpperCase();
      var rect = this.getBoundingClientRect();
      var isAfter = (ev.clientY - rect.top) > (rect.height / 2);
      clearDragClasses();
      reorderSymbols(state.dragSymbol, targetSymbol, isAfter);
      state.dragSymbol = null;
    });

    rows[r].addEventListener("dragend", function () {
      clearDragClasses();
      state.dragSymbol = null;
    });
  }

  var activeEntry = getSymbolEntry();
  var note = document.getElementById("leftNote");
  var msg = safeText(activeEntry && activeEntry.error ? activeEntry.error : "").trim();
  note.textContent = msg || ("Loaded " + symbols.length + " symbol(s). Drag rows to reorder.");
}

function renderCards(symbolEntry, bucketData) {
  var metric = bucketData && bucketData.metric ? bucketData.metric : {};
  var oi = symbolEntry && symbolEntry.oi_summary ? symbolEntry.oi_summary : {};
  var source = safeText(symbolEntry && symbolEntry.source ? symbolEntry.source : "unknown");

  document.getElementById("cardSpot").textContent = "Spot: " + fmtNum(metric.spot);
  document.getElementById("cardSign").textContent = "Sign: " + safeText(metric.sign || "N/A") + " | Net " + fmtBn(metric.net_gex);
  document.getElementById("cardFlip").textContent = "Flip: " + fmtNum(metric.flip_price) + " | Source: " + source;
  document.getElementById("cardWalls").textContent =
    "CallW " + fmtNum(metric.call_wall) + " | PutW " + fmtNum(metric.put_wall) + " | OI " + fmtInt(oi.contracts);
}

function getOIRows(symbolEntry) {
  var rows = symbolEntry && Array.isArray(symbolEntry.oi_rows) ? symbolEntry.oi_rows.slice() : [];
  if (rows.length) return rows;

  var bucket = getBucketData(symbolEntry);
  var fallback = bucket && Array.isArray(bucket.top_oi) ? bucket.top_oi : [];
  var out = [];
  for (var i = 0; i < fallback.length; i++) {
    out.push({
      expiration: fallback[i].expiration,
      strike: fallback[i].strike,
      option_type: fallback[i].option_type,
      open_interest: fallback[i].open_interest,
    });
  }
  return out;
}

function getAllExpirations(symbolEntry) {
  var listed = symbolEntry && Array.isArray(symbolEntry.oi_expirations) ? symbolEntry.oi_expirations.slice() : [];
  if (listed.length) {
    var clean = [];
    for (var i = 0; i < listed.length; i++) {
      var v = safeText(listed[i]);
      if (v) clean.push(v);
    }
    return uniqueSorted(clean);
  }

  var rows = getOIRows(symbolEntry);
  var expirations = [];
  for (var j = 0; j < rows.length; j++) {
    var exp = safeText(rows[j].expiration);
    if (exp) expirations.push(exp);
  }
  return uniqueSorted(expirations);
}

function ensureExpirationSelection(expirations) {
  if (!expirations.length) {
    state.selectedExpirations = [];
    state.expTouched = false;
    return;
  }

  if (!state.expTouched && state.selectedExpirations.length === 0) {
    state.selectedExpirations = expirations.slice();
    return;
  }

  var next = [];
  for (var i = 0; i < expirations.length; i++) {
    if (hasSelectedExp(expirations[i])) next.push(expirations[i]);
  }
  state.selectedExpirations = next;
}

function updateExpirationSummary(all) {
  var summary = document.getElementById("oiExpSummary");
  var total = all.length;
  var selected = state.selectedExpirations.length;

  if (!total) {
    summary.textContent = "No expiration rows";
    return;
  }
  if (selected === 0) summary.textContent = "None selected";
  else if (selected === total) summary.textContent = "All expirations";
  else summary.textContent = selected + "/" + total + " selected";
}

function renderOIExpirationFilter(symbolEntry) {
  var holder = document.getElementById("oiExpirations");
  var expirations = getAllExpirations(symbolEntry);
  holder.innerHTML = "";

  ensureExpirationSelection(expirations);

  var html = "";
  for (var i = 0; i < expirations.length; i++) {
    var exp = expirations[i];
    var id = "exp-" + exp.replace(/[^0-9]/g, "");
    var checked = hasSelectedExp(exp) ? "checked" : "";
    html += '<label class="oi-exp-item"><input id="' + id + '" type="checkbox" value="' + exp + '" ' + checked + ' /> ' + fmtExp(exp) + ' (' + exp + ")</label>";
  }
  holder.innerHTML = html;

  var checkboxes = holder.querySelectorAll("input[type='checkbox']");
  for (var c = 0; c < checkboxes.length; c++) {
    checkboxes[c].addEventListener("change", function () {
      var expVal = safeText(this.value);
      state.expTouched = true;
      if (this.checked) addSelectedExp(expVal);
      else removeSelectedExp(expVal);
      updateExpirationSummary(expirations);
      renderOI(symbolEntry);
    });
  }

  document.getElementById("oiAllBtn").onclick = function () {
    setSelectedExpList(expirations);
    state.expTouched = true;
    renderOIExpirationFilter(symbolEntry);
    renderOI(symbolEntry);
  };

  document.getElementById("oiNoneBtn").onclick = function () {
    state.selectedExpirations = [];
    state.expTouched = true;
    renderOIExpirationFilter(symbolEntry);
    renderOI(symbolEntry);
  };

  updateExpirationSummary(expirations);
}

function getFilteredOIRows(symbolEntry) {
  var rows = getOIRows(symbolEntry);
  if (!rows.length) return [];
  if (!state.selectedExpirations.length) return [];

  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var exp = safeText(rows[i].expiration);
    if (hasSelectedExp(exp)) out.push(rows[i]);
  }
  return out;
}

function annotateLines(metric) {
  var shapes = [];
  var annotations = [];

  if (metric.call_wall != null && metric.put_wall != null) {
    var left = Math.min(metric.call_wall, metric.put_wall);
    var right = Math.max(metric.call_wall, metric.put_wall);
    shapes.push({
      type: "rect",
      x0: left,
      x1: right,
      y0: 0,
      y1: 1,
      yref: "paper",
      fillcolor: "rgba(125, 190, 180, 0.14)",
      line: { width: 0 },
      layer: "below",
    });
  }

  if (metric.spot != null) {
    shapes.push({ type: "line", x0: metric.spot, x1: metric.spot, y0: 0, y1: 1, yref: "paper", line: { color: CFG.spot, width: 2 } });
    annotations.push({ x: metric.spot, y: 0.95, yref: "paper", text: "Spot " + fmtNum(metric.spot), showarrow: false, font: { color: CFG.spot, size: 11 } });
  }
  if (metric.call_wall != null) {
    shapes.push({ type: "line", x0: metric.call_wall, x1: metric.call_wall, y0: 0, y1: 1, yref: "paper", line: { color: CFG.call, width: 1.3, dash: "dash" } });
    annotations.push({ x: metric.call_wall, y: 0.08, yref: "paper", text: "CallW " + fmtNum(metric.call_wall), showarrow: false, font: { color: CFG.call, size: 10 } });
  }
  if (metric.put_wall != null) {
    shapes.push({ type: "line", x0: metric.put_wall, x1: metric.put_wall, y0: 0, y1: 1, yref: "paper", line: { color: CFG.put, width: 1.3, dash: "dash" } });
    annotations.push({ x: metric.put_wall, y: 0.14, yref: "paper", text: "PutW " + fmtNum(metric.put_wall), showarrow: false, font: { color: CFG.put, size: 10 } });
  }
  if (metric.flip_price != null) {
    shapes.push({ type: "line", x0: metric.flip_price, x1: metric.flip_price, y0: 0, y1: 1, yref: "paper", line: { color: CFG.flip, width: 1.2, dash: "dot" } });
    annotations.push({ x: metric.flip_price, y: 0.02, yref: "paper", text: "Flip " + fmtNum(metric.flip_price), showarrow: false, font: { color: "#d8d8d8", size: 10 } });
  }

  return { shapes: shapes, annotations: annotations };
}

function renderLevels(bucketData) {
  var metric = bucketData && bucketData.metric ? bucketData.metric : {};
  var rows = bucketData && Array.isArray(bucketData.strike_profile) ? bucketData.strike_profile : [];

  if (!rows.length) {
    safePlot("levelsChart", [], {
      margin: { l: 64, r: 18, t: 20, b: 46 },
      xaxis: { title: "Strike", gridcolor: CFG.grid },
      yaxis: { title: "Gamma (Bn$ per 1% move)", gridcolor: CFG.grid },
      paper_bgcolor: CFG.bg,
      plot_bgcolor: CFG.bg,
      font: { color: CFG.text },
      annotations: [{ text: "No strike profile.", x: 0.5, y: 0.5, xref: "paper", yref: "paper", showarrow: false }],
    }, baseConfig);
    return;
  }

  var x = [];
  var callY = [];
  var putY = [];
  var netY = [];
  for (var i = 0; i < rows.length; i++) {
    x.push(toNum(rows[i].strike));
    callY.push((toNum(rows[i].call_gex) || 0) / 1e9);
    putY.push((toNum(rows[i].put_gex) || 0) / 1e9);
    netY.push((toNum(rows[i].net_gex) || 0) / 1e9);
  }

  var traces = [
    { type: "bar", x: x, y: callY, name: "Call GEX", marker: { color: CFG.call }, opacity: 0.62, hovertemplate: "Strike %{x}<br>Call %{y:.3f} Bn<extra></extra>" },
    { type: "bar", x: x, y: putY, name: "Put GEX", marker: { color: CFG.put }, opacity: 0.62, hovertemplate: "Strike %{x}<br>Put %{y:.3f} Bn<extra></extra>" },
    { type: "scatter", mode: "lines+markers", x: x, y: netY, name: "Net GEX", line: { color: CFG.net, width: 2 }, marker: { size: 4 }, hovertemplate: "Strike %{x}<br>Net %{y:.3f} Bn<extra></extra>" },
  ];

  var lines = annotateLines(metric);
  var layout = baseLayout("Strike", "Gamma (Bn$ per 1% move)");
  layout.barmode = "overlay";
  layout.shapes = lines.shapes;
  layout.annotations = lines.annotations;

  var xRange = getDefaultPriceRange(metric.spot);
  if (xRange) layout.xaxis.range = xRange;

  safePlot("levelsChart", traces, layout, baseConfig);
}

function renderFlip(bucketData) {
  var metric = bucketData && bucketData.metric ? bucketData.metric : {};
  var curve = bucketData && Array.isArray(bucketData.gex_curve) ? bucketData.gex_curve : [];

  if (!curve.length) {
    safePlot("flipChart", [], {
      margin: { l: 64, r: 18, t: 20, b: 46 },
      xaxis: { title: "Spot", gridcolor: CFG.grid },
      yaxis: { title: "Net GEX (Bn$ per 1% move)", gridcolor: CFG.grid },
      paper_bgcolor: CFG.bg,
      plot_bgcolor: CFG.bg,
      font: { color: CFG.text },
      annotations: [{ text: "No flip curve.", x: 0.5, y: 0.5, xref: "paper", yref: "paper", showarrow: false }],
    }, baseConfig);
    return;
  }

  var x = [];
  var y = [];
  var yPos = [];
  var yNeg = [];
  for (var i = 0; i < curve.length; i++) {
    var xv = toNum(curve[i].spot);
    var yv = (toNum(curve[i].net_gex) || 0) / 1e9;
    x.push(xv);
    y.push(yv);
    yPos.push(yv >= 0 ? yv : null);
    yNeg.push(yv <= 0 ? yv : null);
  }

  var traces = [
    { type: "scatter", mode: "lines", x: x, y: yPos, line: { color: "#2e7d32", width: 1.2 }, name: "Positive Zone", fill: "tozeroy", fillcolor: "rgba(46,125,50,0.18)", hoverinfo: "skip" },
    { type: "scatter", mode: "lines", x: x, y: yNeg, line: { color: "#b71c1c", width: 1.2 }, name: "Negative Zone", fill: "tozeroy", fillcolor: "rgba(183,28,28,0.18)", hoverinfo: "skip" },
    { type: "scatter", mode: "lines", x: x, y: y, line: { color: "#7E57C2", width: 2.2 }, name: "Net GEX Curve", hovertemplate: "Spot %{x:.2f}<br>Net %{y:.3f} Bn<extra></extra>" },
  ];

  var minX = Math.min.apply(null, x);
  var maxX = Math.max.apply(null, x);

  var shapes = [{ type: "line", x0: minX, x1: maxX, y0: 0, y1: 0, line: { color: "#90a4ae", width: 1 } }];
  if (metric.spot != null) shapes.push({ type: "line", x0: metric.spot, x1: metric.spot, y0: 0, y1: 1, yref: "paper", line: { color: CFG.spot, width: 1.6 } });
  if (metric.flip_price != null) shapes.push({ type: "line", x0: metric.flip_price, x1: metric.flip_price, y0: 0, y1: 1, yref: "paper", line: { color: CFG.flip, width: 1.2, dash: "dot" } });

  var layout = baseLayout("Hypothetical Spot Price", "Net GEX (Bn$ per 1% move)");
  layout.shapes = shapes;
  var xRange = getDefaultPriceRange(metric.spot);
  if (xRange) layout.xaxis.range = xRange;

  safePlot("flipChart", traces, layout, baseConfig);
}

function renderTrend(bucketData) {
  var history = bucketData && Array.isArray(bucketData.history) ? bucketData.history.slice() : [];

  if (!history.length) {
    safePlot("trendChart", [], {
      margin: { l: 64, r: 18, t: 20, b: 46 },
      xaxis: { title: "Run Time", gridcolor: CFG.grid, type: "date" },
      yaxis: { title: "Net GEX (Bn$ per 1% move)", gridcolor: CFG.grid },
      paper_bgcolor: CFG.bg,
      plot_bgcolor: CFG.bg,
      font: { color: CFG.text },
      annotations: [{ text: "No trend history.", x: 0.5, y: 0.5, xref: "paper", yref: "paper", showarrow: false }],
    }, baseConfig);
    return;
  }

  history.sort(function (a, b) {
    var taObj = parseTime(a.finished_at);
    var tbObj = parseTime(b.finished_at);
    var ta = taObj ? taObj.getTime() : 0;
    var tb = tbObj ? tbObj.getTime() : 0;
    return ta - tb;
  });

  var x = [];
  var y = [];
  var cd = [];
  for (var i = 0; i < history.length; i++) {
    x.push(parseTime(history[i].finished_at));
    y.push((toNum(history[i].net_gex) || 0) / 1e9);
    cd.push([toNum(history[i].spot), toNum(history[i].flip_price), safeText(history[i].sign)]);
  }

  safePlot("trendChart", [
    {
      type: "scatter",
      mode: "lines+markers",
      x: x,
      y: y,
      line: { color: "#1B9E77", width: 2 },
      marker: { size: 6 },
      name: "Net GEX",
      customdata: cd,
      hovertemplate: "Time %{x|%Y-%m-%d %H:%M}<br>Net %{y:.3f} Bn<br>Spot %{customdata[0]:.2f}<br>Flip %{customdata[1]:.2f}<br>Sign %{customdata[2]}<extra></extra>",
    },
  ],
  {
    margin: { l: 64, r: 18, t: 20, b: 46 },
    xaxis: { title: "Run Time", gridcolor: CFG.grid, type: "date" },
    yaxis: { title: "Net GEX (Bn$ per 1% move)", gridcolor: CFG.grid, zeroline: true, zerolinecolor: "#7b8798", zerolinewidth: 1 },
    dragmode: "pan",
    paper_bgcolor: CFG.bg,
    plot_bgcolor: CFG.bg,
    font: { color: CFG.text },
    legend: { orientation: "h" },
  }, baseConfig);
}

function renderBucketCompare(symbolEntry) {
  var buckets = ["front", "core", "medium"];
  var labels = { front: "Front (0-7)", core: "Core (8-90)", medium: "Medium (46-90)" };
  var colors = { front: CFG.front, core: CFG.core, medium: CFG.medium };
  var traces = [];

  for (var i = 0; i < buckets.length; i++) {
    var bucket = buckets[i];
    var data = getBucketData(symbolEntry, bucket);
    var rows = data && Array.isArray(data.strike_profile) ? data.strike_profile : [];
    if (!rows.length) continue;

    var x = [];
    var y = [];
    for (var j = 0; j < rows.length; j++) {
      x.push(toNum(rows[j].strike));
      y.push((toNum(rows[j].net_gex) || 0) / 1e9);
    }

    traces.push({
      type: "scatter",
      mode: "lines+markers",
      x: x,
      y: y,
      name: labels[bucket],
      line: { color: colors[bucket], width: 2 },
      marker: { size: 3 },
      hovertemplate: labels[bucket] + "<br>Strike %{x}<br>Net %{y:.3f} Bn<extra></extra>",
    });
  }

  if (!traces.length) {
    safePlot("bucketChart", [], {
      margin: { l: 64, r: 18, t: 20, b: 46 },
      xaxis: { title: "Strike", gridcolor: CFG.grid },
      yaxis: { title: "Net GEX (Bn$ per 1% move)", gridcolor: CFG.grid },
      paper_bgcolor: CFG.bg,
      plot_bgcolor: CFG.bg,
      font: { color: CFG.text },
      annotations: [{ text: "No bucket comparison data.", x: 0.5, y: 0.5, xref: "paper", yref: "paper", showarrow: false }],
    }, baseConfig);
    return;
  }

  var metric = getMetric(symbolEntry, state.bucket);
  var layout = baseLayout("Strike", "Net GEX (Bn$ per 1% move)");
  layout.shapes = [];
  if (metric.spot != null) {
    layout.shapes.push({ type: "line", x0: metric.spot, x1: metric.spot, y0: 0, y1: 1, yref: "paper", line: { color: CFG.spot, width: 1.8 } });
  }
  var xRange = getDefaultPriceRange(metric.spot);
  if (xRange) layout.xaxis.range = xRange;

  safePlot("bucketChart", traces, layout, baseConfig);
}

function renderOI(symbolEntry) {
  var rows = getFilteredOIRows(symbolEntry);
  rows.sort(function (a, b) {
    return (toNum(b.open_interest) || 0) - (toNum(a.open_interest) || 0);
  });
  var top = rows.slice(0, 24);

  if (!top.length) {
    safePlot("oiChart", [], {
      margin: { l: 64, r: 18, t: 20, b: 46 },
      xaxis: { title: "Open Interest", gridcolor: CFG.grid },
      yaxis: { title: "Contract", gridcolor: CFG.grid },
      paper_bgcolor: CFG.bg,
      plot_bgcolor: CFG.bg,
      font: { color: CFG.text },
      annotations: [{ text: "No OI rows for selected expiration(s).", x: 0.5, y: 0.5, xref: "paper", yref: "paper", showarrow: false }],
    }, baseConfig);
    document.getElementById("oiTableWrap").innerHTML = '<div class="hint">No OI rows for selected expiration(s).</div>';
    return;
  }

  function makeLabel(r) {
    var cp = safeText(r.option_type).toLowerCase().indexOf("c") === 0 ? "C" : "P";
    return safeText(symbolEntry.symbol) + " " + fmtExp(r.expiration) + " " + fmtNum(r.strike) + cp;
  }

  var calls = [];
  var puts = [];
  var maxOi = 1;
  for (var i = 0; i < top.length; i++) {
    var oi = toNum(top[i].open_interest) || 0;
    if (oi > maxOi) maxOi = oi;
    if (safeText(top[i].option_type).toLowerCase().indexOf("c") === 0) calls.push(top[i]);
    else puts.push(top[i]);
  }

  function mapX(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) out.push(toNum(arr[i].open_interest) || 0);
    return out;
  }
  function mapY(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) out.push(makeLabel(arr[i]));
    return out;
  }
  function mapText(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) out.push(fmtInt(arr[i].open_interest));
    return out;
  }

  safePlot("oiChart", [
    {
      type: "bar",
      orientation: "h",
      x: mapX(calls),
      y: mapY(calls),
      marker: { color: CFG.call },
      name: "Calls",
      text: mapText(calls),
      textposition: "outside",
      cliponaxis: false,
      hovertemplate: "%{y}<br>OI %{x:,}<extra></extra>",
    },
    {
      type: "bar",
      orientation: "h",
      x: mapX(puts),
      y: mapY(puts),
      marker: { color: "#E58A8A" },
      name: "Puts",
      text: mapText(puts),
      textposition: "outside",
      cliponaxis: false,
      hovertemplate: "%{y}<br>OI %{x:,}<extra></extra>",
    },
  ],
  {
    margin: { l: 240, r: 24, t: 10, b: 36 },
    xaxis: { title: "Open Interest", range: [0, maxOi * 1.2], gridcolor: CFG.grid },
    yaxis: { automargin: true },
    barmode: "overlay",
    dragmode: "pan",
    paper_bgcolor: CFG.bg,
    plot_bgcolor: CFG.bg,
    font: { color: CFG.text },
    legend: { orientation: "h" },
  }, baseConfig);

  var body = "";
  for (var j = 0; j < top.length; j++) {
    var cp = safeText(top[j].option_type).toLowerCase().indexOf("c") === 0 ? "C" : "P";
    body += "<tr><td>" + fmtExp(top[j].expiration) + "</td><td>" + fmtNum(top[j].strike) + "</td><td>" + cp + "</td><td>" + fmtInt(top[j].open_interest) + "</td></tr>";
  }

  document.getElementById("oiTableWrap").innerHTML =
    "<table><thead><tr><th>Expiration</th><th>Strike</th><th>Type</th><th>Open Interest</th></tr></thead><tbody>" + body + "</tbody></table>";
}

function renderHeatmap(bucketData) {
  var rows = bucketData && Array.isArray(bucketData.heatmap_history) ? bucketData.heatmap_history : [];

  if (!rows.length) {
    safePlot("heatmapChart", [], {
      margin: { l: 64, r: 18, t: 20, b: 46 },
      xaxis: { title: "Run Time", gridcolor: CFG.grid, type: "date" },
      yaxis: { title: "Strike", gridcolor: CFG.grid },
      paper_bgcolor: CFG.bg,
      plot_bgcolor: CFG.bg,
      font: { color: CFG.text },
      annotations: [{ text: "No gamma heatmap history.", x: 0.5, y: 0.5, xref: "paper", yref: "paper", showarrow: false }],
    }, baseConfig);
    return;
  }

  var items = [];
  for (var i = 0; i < rows.length; i++) {
    var t = parseTime(rows[i].finished_at);
    var strike = toNum(rows[i].strike);
    if (!t || strike === null) continue;
    items.push({
      t: t,
      iso: t.toISOString(),
      strike: strike,
      net: (toNum(rows[i].net_gex) || 0) / 1e9,
      spot: toNum(rows[i].spot),
    });
  }

  if (!items.length) {
    safePlot("heatmapChart", [], {
      margin: { l: 64, r: 18, t: 20, b: 46 },
      xaxis: { title: "Run Time", gridcolor: CFG.grid, type: "date" },
      yaxis: { title: "Strike", gridcolor: CFG.grid },
      paper_bgcolor: CFG.bg,
      plot_bgcolor: CFG.bg,
      font: { color: CFG.text },
      annotations: [{ text: "No gamma heatmap history.", x: 0.5, y: 0.5, xref: "paper", yref: "paper", showarrow: false }],
    }, baseConfig);
    return;
  }

  items.sort(function (a, b) {
    var dt = a.t.getTime() - b.t.getTime();
    if (dt !== 0) return dt;
    return a.strike - b.strike;
  });

  var times = [];
  var timesSeen = {};
  var strikes = [];
  var strikesSeen = {};

  for (var j = 0; j < items.length; j++) {
    if (!timesSeen[items[j].iso]) {
      timesSeen[items[j].iso] = true;
      times.push(items[j].t);
    }
    var sKey = String(items[j].strike);
    if (!strikesSeen[sKey]) {
      strikesSeen[sKey] = true;
      strikes.push(items[j].strike);
    }
  }
  strikes.sort(function (a, b) { return a - b; });

  var xIndex = {};
  for (var x = 0; x < times.length; x++) xIndex[times[x].toISOString()] = x;
  var yIndex = {};
  for (var y = 0; y < strikes.length; y++) yIndex[String(strikes[y])] = y;

  var z = [];
  for (var yi = 0; yi < strikes.length; yi++) {
    var row = [];
    for (var xi = 0; xi < times.length; xi++) row.push(null);
    z.push(row);
  }

  for (var k = 0; k < items.length; k++) {
    var iX = xIndex[items[k].iso];
    var iY = yIndex[String(items[k].strike)];
    if (iX === undefined || iY === undefined) continue;
    z[iY][iX] = items[k].net;
  }

  var absVals = [];
  for (var a = 0; a < z.length; a++) {
    for (var b = 0; b < z[a].length; b++) {
      if (typeof z[a][b] === "number") absVals.push(Math.abs(z[a][b]));
    }
  }
  var maxAbs = 1;
  if (absVals.length) {
    absVals.sort(function (u, v) { return u - v; });
    var idx = Math.floor(absVals.length * 0.98);
    if (idx < 0) idx = 0;
    if (idx >= absVals.length) idx = absVals.length - 1;
    maxAbs = absVals[idx] || 1;
  }

  var spotByIso = {};
  for (var m = 0; m < items.length; m++) {
    if (items[m].spot !== null) spotByIso[items[m].iso] = items[m].spot;
  }
  var spotLine = [];
  for (var n = 0; n < times.length; n++) {
    var key = times[n].toISOString();
    spotLine.push(Object.prototype.hasOwnProperty.call(spotByIso, key) ? spotByIso[key] : null);
  }

  safePlot("heatmapChart", [
    {
      type: "heatmap",
      x: times,
      y: strikes,
      z: z,
      zmid: 0,
      zmin: -maxAbs,
      zmax: maxAbs,
      colorscale: [[0.0, "#d73027"], [0.5, "#f7f7f7"], [1.0, "#4575b4"]],
      colorbar: { title: "Net GEX (Bn)" },
      hovertemplate: "Time %{x|%Y-%m-%d %H:%M}<br>Strike %{y:.2f}<br>Net %{z:.3f} Bn<extra></extra>",
    },
    {
      type: "scatter",
      mode: "lines",
      x: times,
      y: spotLine,
      line: { color: "#111111", width: 2 },
      name: "Spot Path",
      hovertemplate: "Time %{x|%Y-%m-%d %H:%M}<br>Spot %{y:.2f}<extra></extra>",
    },
  ],
  {
    margin: { l: 64, r: 18, t: 20, b: 46 },
    xaxis: { title: "Run Time", gridcolor: CFG.grid, type: "date" },
    yaxis: { title: "Strike", gridcolor: CFG.grid },
    dragmode: "pan",
    paper_bgcolor: CFG.bg,
    plot_bgcolor: CFG.bg,
    font: { color: CFG.text },
    legend: { orientation: "h" },
  }, baseConfig);
}

function setHint() {
  var hint = document.getElementById("chartHint");
  hint.textContent = TAB_HINTS[state.activeTab] || "";
}

function activateTab(tabName) {
  state.activeTab = tabName;

  var btns = document.querySelectorAll(".tab-btn");
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle("active", btns[i].getAttribute("data-tab") === tabName);
  }

  var panels = document.querySelectorAll(".tab-panel");
  for (var j = 0; j < panels.length; j++) {
    panels[j].classList.toggle("active", panels[j].id === "panel-" + tabName);
  }

  var quick = document.getElementById("tabSelect");
  if (quick.value !== tabName) quick.value = tabName;
  setHint();
}

function renderAll() {
  var symbolEntry = getSymbolEntry();
  if (!symbolEntry) return;

  var bucketData = getBucketData(symbolEntry);
  renderSnapshotTable();
  renderCards(symbolEntry, bucketData);
  renderOIExpirationFilter(symbolEntry);

  try { renderLevels(bucketData); } catch (e1) {}
  try { renderFlip(bucketData); } catch (e2) {}
  try { renderTrend(bucketData); } catch (e3) {}
  try { renderBucketCompare(symbolEntry); } catch (e4) {}
  try { renderOI(symbolEntry); } catch (e5) {}
  try { renderHeatmap(bucketData); } catch (e6) {}

  setHint();
}

function bindEvents() {
  document.getElementById("symbolSelect").addEventListener("change", function (ev) {
    state.symbol = safeText(ev.target.value).toUpperCase();
    state.selectedExpirations = [];
    state.expTouched = false;
    renderAll();
  });

  document.getElementById("bucketSelect").addEventListener("change", function (ev) {
    state.bucket = safeText(ev.target.value) || "core";
    renderAll();
  });

  document.getElementById("tabSelect").addEventListener("change", function (ev) {
    activateTab(safeText(ev.target.value) || "levels");
  });

  var btns = document.querySelectorAll(".tab-btn");
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener("click", function () {
      activateTab(this.getAttribute("data-tab"));
    });
  }
}

function loadSnapshot() {
  var url = "./latest.json?v=" + Date.now();
  fetch(url)
    .then(function (resp) {
      if (!resp.ok) throw new Error("Failed to load latest.json (" + resp.status + ")");
      return resp.json();
    })
    .then(function (data) {
      state.payload = data;
      renderMeta();
      renderSymbolSelect();
      bindEvents();
      activateTab("levels");
      renderAll();
    })
    .catch(function (err) {
      var line = document.getElementById("metaLine");
      line.textContent = "Load failed: " + err.message;
    });
}

loadSnapshot();
