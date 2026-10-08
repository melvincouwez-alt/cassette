// Cassette side panel. State arrives from src/sidePanel.ts through the preload
// (window.cassettePanel); clicks go back as actions naming rows by index.
(function () {
  "use strict";
  var bridge = window.cassettePanel;
  var state = null;

  function $(id) { return document.getElementById(id); }
  function send(action) { if (bridge) bridge.send(action); }

  // --- Tabs ---
  document.querySelectorAll("[data-tab]").forEach(function (button) {
    button.addEventListener("click", function () { send({ type: "tab", tab: button.dataset.tab }); });
  });
  $("close").addEventListener("click", function () { send({ type: "close" }); });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") send({ type: "close" });
  });
  var closeIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  closeIcon.setAttribute("viewBox", "0 0 16 16");
  closeIcon.setAttribute("aria-hidden", "true");
  var closePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  closePath.setAttribute("d", "M4 4l8 8M12 4l-8 8");
  closeIcon.appendChild(closePath);
  $("close").appendChild(closeIcon);

  // --- Rows (queue and search) ---
  var KIND_LABEL = { song: "Morceau", album: "Album", artist: "Artiste", playlist: "Playlist" };

  function rowElement(row, index, onClick, extra) {
    var li = document.createElement("li");
    var button = document.createElement("button");
    button.type = "button";
    var art = document.createElement("span");
    art.className = row.kind === "artist" ? "art round" : "art";
    if (row.artwork) {
      var img = document.createElement("img");
      img.alt = "";
      img.src = row.artwork;
      art.appendChild(img);
    }
    var meta = document.createElement("span");
    meta.className = "meta";
    var title = document.createElement("span");
    title.className = "title";
    title.textContent = row.title;
    var subtitle = document.createElement("span");
    subtitle.className = "subtitle";
    subtitle.textContent = extra ? extra + (row.subtitle ? " · " + row.subtitle : "") : row.subtitle;
    meta.append(title, subtitle);
    button.append(art, meta);
    button.addEventListener("click", function () { onClick(index); });
    li.appendChild(button);
    return li;
  }

  // --- Lyrics ---
  var lines = [];
  var lyricsSource = null;
  var activeLine = -1;

  // TTML clock values: "12.3", "1:02.300" or "1:02:03.5".
  function seconds(value) {
    if (!value) return NaN;
    var parts = value.split(":").map(Number);
    return parts.reduce(function (total, part) { return total * 60 + part; }, 0);
  }

  function renderLyrics(ttml) {
    if (ttml === lyricsSource) return;
    lyricsSource = ttml;
    lines = [];
    activeLine = -1;
    var box = $("lyrics-lines");
    box.replaceChildren();
    if (!ttml) return;
    var doc = new DOMParser().parseFromString(ttml, "application/xml");
    if (doc.querySelector("parsererror")) return;
    var timed = (doc.documentElement.getAttribute("itunes:timing") || "") !== "None";
    var lastDiv = null;
    Array.prototype.forEach.call(doc.getElementsByTagNameNS("*", "p"), function (p) {
      var div = p.parentNode;
      var el = document.createElement("p");
      el.textContent = p.textContent.replace(/\s+/g, " ").trim();
      if (div !== lastDiv && lastDiv !== null) el.className = "verse";
      lastDiv = div;
      var begin = seconds(p.getAttribute("begin"));
      var end = seconds(p.getAttribute("end"));
      lines.push({ el: el, begin: timed ? begin : NaN, end: end });
      box.appendChild(el);
    });
    box.classList.toggle("timed", timed && lines.some(function (l) { return !isNaN(l.begin); }));
  }

  function showPosition(t) {
    if (!lines.length || !(t >= 0)) return;
    var index = -1;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].begin <= t) index = i;
      else if (lines[i].begin > t) break;
    }
    if (index === activeLine) return;
    if (activeLine >= 0) lines[activeLine].el.classList.remove("active");
    activeLine = index;
    if (index >= 0) {
      lines[index].el.classList.add("active");
      lines[index].el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  var LYRICS_STATUS = {
    empty: "Rien en cours de lecture.",
    loading: "Chargement des paroles…",
    none: "Pas de paroles pour ce morceau.",
    error: "Les paroles n'ont pas pu être chargées.",
    ok: "",
  };

  // --- Search ---
  var form = $("search-form");
  var input = $("search-term");
  var debounce = null;
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearTimeout(debounce);
    send({ type: "search", term: input.value });
  });
  input.addEventListener("input", function () {
    clearTimeout(debounce);
    debounce = setTimeout(function () { send({ type: "search", term: input.value }); }, 350);
  });

  var SEARCH_STATUS = {
    idle: "",
    loading: "Recherche…",
    error: "La recherche a échoué.",
  };

  // --- State ---
  var shownTab = null;

  function apply(next) {
    if (typeof next !== "object" || next === null) return;
    state = next;
    document.querySelectorAll("[data-tab]").forEach(function (button) {
      var selected = button.dataset.tab === state.tab;
      button.setAttribute("aria-selected", String(selected));
      $(button.dataset.tab).hidden = !selected;
    });
    if (shownTab !== state.tab) {
      shownTab = state.tab;
      if (state.tab === "search") input.focus();
    }

    $("lyrics-track").textContent = state.track || "";
    var lyrics = state.lyrics || { status: "empty" };
    $("lyrics-status").textContent = LYRICS_STATUS[lyrics.status] || "";
    renderLyrics(lyrics.status === "ok" ? lyrics.ttml : null);

    var queue = state.queue || { items: [], position: -1 };
    $("queue-status").textContent = queue.items.length ? "" : "La file d'attente est vide.";
    var list = $("queue-list");
    list.replaceChildren.apply(list, queue.items.map(function (row, index) {
      var li = rowElement(row, index, function (i) { send({ type: "playQueueItem", index: i }); });
      if (index === queue.position) li.className = "current";
      else if (index < queue.position) li.className = "played";
      return li;
    }));
    var current = list.querySelector(".current");
    if (current && state.tab === "queue") current.scrollIntoView({ block: "nearest" });

    var search = state.search || { term: "", status: "idle", results: [] };
    if (document.activeElement !== input && input.value !== search.term) input.value = search.term;
    $("search-status").textContent = search.status === "ok" && !search.results.length
      ? "Aucun résultat." : SEARCH_STATUS[search.status] || "";
    var results = $("search-list");
    results.replaceChildren.apply(results, search.results.map(function (row, index) {
      return rowElement(row, index, function (i) { send({ type: "openResult", index: i }); }, KIND_LABEL[row.kind]);
    }));
  }

  if (bridge) {
    bridge.onPosition(showPosition);
    bridge.onState(apply);
  }
})();
