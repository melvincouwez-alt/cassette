// Cassette header bar. State arrives from src/headerbar.ts through the preload
// (window.ariaHeader); clicks go back as one of a fixed set of actions, and a
// click on the scrubber as a fraction of the track. The window buttons are
// drawn by the frame over the padding set from insetStart and insetEnd.
(function () {
  "use strict";
  var bridge = window.ariaHeader;
  var SVG_NS = "http://www.w3.org/2000/svg";

  // 16px symbolic glyphs in the style of elementary's icon set. Entries with
  // stroke: true are drawn as lines rather than filled.
  var ICONS = {
    back: { d: "M10.3 2.6 11.4 3.7 7.1 8l4.3 4.3-1.1 1.1L4.9 8z" },
    forward: { d: "M5.7 2.6 4.6 3.7 8.9 8l-4.3 4.3 1.1 1.1L11.1 8z" },
    settings: { d: "M2 3.5h12V5H2zm0 3.75h12v1.5H2zM2 11h12v1.5H2z" },
    play: { d: "M5 3.2v9.6c0 .6.7 1 1.2.6l7.2-4.8c.4-.3.4-.9 0-1.2L6.2 2.6C5.7 2.2 5 2.6 5 3.2z" },
    pause: { d: "M4.5 3h2.2c.3 0 .5.2.5.5v9c0 .3-.2.5-.5.5H4.5a.5.5 0 0 1-.5-.5v-9c0-.3.2-.5.5-.5zm4.8 0h2.2c.3 0 .5.2.5.5v9c0 .3-.2.5-.5.5H9.3a.5.5 0 0 1-.5-.5v-9c0-.3.2-.5.5-.5z" },
    previous: { d: "M3 3h2v10H3zm11 .8v8.4c0 .6-.7 1-1.2.6L6.6 8.6a.75.75 0 0 1 0-1.2l6.2-4.2c.5-.4 1.2 0 1.2.6z" },
    next: { d: "M11 3h2v10h-2zM2 3.8v8.4c0 .6.7 1 1.2.6l6.2-4.2a.75.75 0 0 0 0-1.2L3.2 3.2C2.7 2.8 2 3.2 2 3.8z" },
    shuffle: { stroke: true, d: "M1.5 4.5h2.3c3.2 0 5.2 7 8.4 7h2.3M1.5 11.5h2.3c3.2 0 5.2-7 8.4-7h2.3M12.8 2.5l1.8 2-1.8 2M12.8 9.5l1.8 2-1.8 2" },
    repeat: { stroke: true, d: "M2.5 7.5V6.3a2 2 0 0 1 2-2h8.8M11.3 2.3l2 2-2 2M13.5 8.5v1.2a2 2 0 0 1-2 2H2.7M4.7 13.7l-2-2 2-2" },
    queue: { d: "M2 3h9v1.5H2zm0 4h9v1.5H2zm0 4h6v1.5H2zm10.5-4.2 3 2.2-3 2.2z" },
    mute: { d: "M2 6h2.5L8 3v10L4.5 10H2z", waves: 2 },
    lyrics: { d: "M3 2.5h10A1.5 1.5 0 0 1 14.5 4v6a1.5 1.5 0 0 1-1.5 1.5H8l-3.2 2.4c-.4.3-.8 0-.8-.4v-2H3A1.5 1.5 0 0 1 1.5 10V4A1.5 1.5 0 0 1 3 2.5zm2.2 3.2v2.1h1.6c0 .7-.4 1.1-1.1 1.2v.9c1.4-.1 2.2-.9 2.2-2.4V5.7zm3.6 0v2.1h1.6c0 .7-.4 1.1-1.1 1.2v.9c1.4-.1 2.2-.9 2.2-2.4V5.7z" },
  };

  // The speaker takes zero, one or two sound waves, or a cross when muted.
  var WAVES = [
    "M10 5.8a3 3 0 0 1 0 4.4",
    "M11.8 3.8a5.8 5.8 0 0 1 0 8.4",
  ];
  var CROSS = "M10.5 6l3.5 4M14 6l-3.5 4";

  function speaker(level) {
    var svg = icon("mute");
    var extra = level === 0 ? [CROSS] : WAVES.slice(0, level < 0.5 ? 1 : 2);
    extra.forEach(function (d) {
      var path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "wave");
      svg.appendChild(path);
    });
    return svg;
  }

  function icon(name) {
    var spec = ICONS[name];
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    if (spec.stroke) svg.setAttribute("class", "stroke");
    var path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", spec.d);
    svg.appendChild(path);
    return svg;
  }

  function setIcon(button, name) {
    if (button.dataset.icon === name) return;
    button.dataset.icon = name;
    button.replaceChildren(icon(name));
  }

  function $(id) { return document.getElementById(id); }

  // Cassette's own volume, as MusicKit plays it: the slider sends while it is
  // dragged, and state updates leave it alone until it is let go.
  var volume = $("volume");
  var dragging = false;
  var shownLevel = null;

  function showVolume(level) {
    if (!dragging) volume.value = String(Math.round(level * 100));
    volume.style.setProperty("--level", Math.round(level * 100) + "%");
    var key = level === 0 ? 0 : level < 0.5 ? 1 : 2;
    if (shownLevel !== key) {
      shownLevel = key;
      $("mute").replaceChildren(speaker(level));
    }
    $("mute").title = level === 0 ? "Rétablir le son" : "Couper le son";
  }

  volume.addEventListener("pointerdown", function () { dragging = true; });
  window.addEventListener("pointerup", function () { dragging = false; });
  volume.addEventListener("input", function () {
    var level = Number(volume.value) / 100;
    showVolume(level);
    if (bridge) bridge.setVolume(level);
  });

  document.querySelectorAll("button[data-action]").forEach(function (button) {
    if (button.dataset.action !== "mute")
      setIcon(button, button.dataset.action === "playPause" ? "play" : button.dataset.action);
    button.addEventListener("click", function () {
      if (bridge) bridge.send(button.dataset.action);
    });
  });

  function px(value) {
    return (typeof value === "number" && isFinite(value) && value >= 0 ? value : 0) + "px";
  }

  function clock(seconds) {
    if (!(seconds >= 0) || !isFinite(seconds)) return "0:00";
    var s = Math.floor(seconds);
    var m = Math.floor(s / 60);
    var h = Math.floor(m / 60);
    var ss = String(s % 60).padStart(2, "0");
    return h > 0 ? h + ":" + String(m % 60).padStart(2, "0") + ":" + ss : m + ":" + ss;
  }

  var duration = 0;
  var canSeek = false;
  var scrubber = $("scrubber");

  function showPosition(seconds) {
    var fraction = duration > 0 ? Math.min(1, Math.max(0, seconds / duration)) : 0;
    $("fill").style.width = (fraction * 100).toFixed(2) + "%";
    scrubber.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
    $("elapsed").textContent = clock(seconds);
    $("remaining").textContent = duration > 0 ? "−" + clock(duration - seconds) : "";
  }

  function seekTo(fraction) {
    if (!canSeek || !bridge) return;
    bridge.seek(Math.min(1, Math.max(0, fraction)));
    showPosition(fraction * duration);
  }

  scrubber.addEventListener("click", function (event) {
    var r = scrubber.getBoundingClientRect();
    seekTo((event.clientX - r.left) / r.width);
  });
  scrubber.addEventListener("keydown", function (event) {
    if (!canSeek || duration <= 0) return;
    var now = parseFloat(scrubber.getAttribute("aria-valuenow")) / 100;
    var step = 5 / duration;
    if (event.key === "ArrowRight") seekTo(now + step);
    else if (event.key === "ArrowLeft") seekTo(now - step);
    else return;
    event.preventDefault();
  });

  function applyState(state) {
    if (typeof state !== "object" || state === null) return;
    var title = state.title || "Cassette";
    document.title = title;
    $("title").textContent = title;
    $("back").disabled = !state.canGoBack;
    $("forward").disabled = !state.canGoForward;
    var root = document.documentElement.style;
    root.setProperty("--inset-start", px(state.insetStart));
    root.setProperty("--inset-end", px(state.insetEnd));
    document.body.classList.toggle("loading", !!state.loading);

    var track = state.track;
    $("nowplaying").hidden = !track;
    $("title").hidden = !!track;
    if (track) {
      $("track-title").textContent = track.title;
      $("track-artist").textContent = track.artist;
      var art = $("art");
      if (/^https:\/\/[a-z0-9.-]+\.mzstatic\.com\//i.test(track.artwork || "")) {
        if (art.getAttribute("src") !== track.artwork) art.src = track.artwork;
      } else {
        art.removeAttribute("src");
      }
    }
    ["previous", "playPause", "next", "shuffle", "repeat", "lyrics"].forEach(function (id) {
      $(id).disabled = !track;
    });

    setIcon($("playPause"), state.playing ? "pause" : "play");
    $("playPause").title = state.playing ? "Pause" : "Lecture";
    duration = state.duration > 0 ? state.duration : 0;
    canSeek = !!state.canSeek;
    scrubber.classList.toggle("no-seek", !canSeek);
    $("fill").style.transition = state.playing ? "" : "none";

    $("shuffle").classList.toggle("active", !!state.shuffle);
    var repeat = $("repeat");
    repeat.classList.toggle("active", state.repeat === 1 || state.repeat === 2);
    if (state.repeat === 1) repeat.dataset.badge = "1";
    else delete repeat.dataset.badge;
    showVolume(typeof state.volume === "number" && state.volume >= 0 && state.volume <= 1 ? state.volume : 1);
    repeat.title = state.repeat === 1 ? "Répéter le morceau" : state.repeat === 2 ? "Répéter tout" : "Répéter";
  }

  showVolume(1);

  if (bridge) {
    bridge.onPosition(showPosition);
    bridge.onState(applyState);
  }
})();
