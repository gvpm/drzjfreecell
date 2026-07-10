(() => {
  "use strict";

  const STORAGE_KEY = "drzj-freecell-state-v1";
  const OPTIONS_KEY = "drzj-freecell-options-v1";
  const BEST_KEY = "drzj-freecell-best-v1";
  const STATS_KEY = "drzj-freecell-stats-v1";
  const AUTOPLAY_SPEEDS = [900, 550, 300, 150, 70];
  const MICROSOFT_MAX_DEAL = 1000000;
  const MICROSOFT_SUITS = ["C", "D", "H", "S"];
  const UNSOLVABLE_DEALS = new Set([11982, 146692, 186216, 455889, 495505, 512118, 517776, 781948]);
  const SUITS = ["S", "H", "D", "C"];
  const SUIT_NAMES = { S: "espadas", H: "copas", D: "ouros", C: "paus" };
  const SUIT_SYMBOLS = { S: "♠", H: "♥", D: "♦", C: "♣" };
  const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const RED_SUITS = new Set(["H", "D"]);

  const els = {
    timer: document.querySelector("#timer"),
    dealNumber: document.querySelector("#dealNumber"),
    cardsLeft: document.querySelector("#cardsLeft"),
    bestTime: document.querySelector("#bestTime"),
    avgTime: document.querySelector("#avgTime"),
    gameInfo: document.querySelector("#gameInfo"),
    infoDeal: document.querySelector("#infoDeal"),
    infoMoves: document.querySelector("#infoMoves"),
    infoFinished: document.querySelector("#infoFinished"),
    infoDifficulty: document.querySelector("#infoDifficulty"),
    infoBest: document.querySelector("#infoBest"),
    infoAverage: document.querySelector("#infoAverage"),
    freecells: document.querySelector("#freecells"),
    foundations: document.querySelector("#foundations"),
    cascades: document.querySelector("#cascades"),
    statusLine: document.querySelector("#statusLine"),
    quickUndoBtn: document.querySelector("#quickUndoBtn"),
    slowerBtn: document.querySelector("#slowerBtn"),
    fasterBtn: document.querySelector("#fasterBtn"),
    menuSummary: document.querySelector("#menuSummary"),
    autoplayBtn: document.querySelector("#autoplayBtn"),
    newGameBtn: document.querySelector("#newGameBtn"),
    selectGameBtn: document.querySelector("#selectGameBtn"),
    restartBtn: document.querySelector("#restartBtn"),
    autoPromoteToggle: document.querySelector("#autoPromoteToggle"),
    nightModeToggle: document.querySelector("#nightModeToggle"),
    difficultySelect: document.querySelector("#difficultySelect"),
    deckSelect: document.querySelector("#deckSelect"),
    winOverlay: document.querySelector("#winOverlay"),
    winText: document.querySelector("#winText"),
    winNewGameBtn: document.querySelector("#winNewGameBtn"),
    menu: document.querySelector("#menu")
  };

  let state;
  let selected = null;
  let timerHandle = null;
  let lastTap = { id: null, time: 0 };
  let options = loadOptions();
  let stats = loadStats();
  let drag = null;
  let suppressClickUntil = 0;
  let autoplayTimer = null;
  let autoplayRunning = false;
  let autoplayPlan = [];
  let solverTimer = null;
  let longPressTimer = null;
  let longPressTriggered = false;
  let difficultyReference = null;

  function cardId(suit, rank) {
    return `${rank}${suit}`;
  }

  function indexForSuit(suit) {
    return SUITS.indexOf(suit);
  }

  function parseCard(id) {
    const suit = id.slice(-1);
    const rank = Number(id.slice(0, -1));
    return {
      id,
      suit,
      rank,
      color: RED_SUITS.has(suit) ? "red" : "black",
      label: `${RANKS[rank]}${SUIT_SYMBOLS[suit]}`
    };
  }

  function newDeck() {
    const deck = [];
    for (const suit of SUITS) {
      for (let rank = 1; rank <= 13; rank += 1) {
        deck.push(cardId(suit, rank));
      }
    }
    return deck;
  }

  function microsoftRandFactory(dealNumber) {
    let seed = dealNumber >>> 0;
    return function microsoftRand() {
      seed = (Math.imul(seed, 214013) + 2531011) >>> 0;
      return (seed >>> 16) & 0x7fff;
    };
  }

  function microsoftDeck() {
    const deck = [];
    for (let rank = 1; rank <= 13; rank += 1) {
      for (const suit of MICROSOFT_SUITS) {
        deck.push(cardId(suit, rank));
      }
    }
    return deck;
  }

  function microsoftDeal(dealNumber) {
    const rand = microsoftRandFactory(dealNumber);
    const source = microsoftDeck();
    const dealt = [];
    while (source.length) {
      const index = rand() % source.length;
      dealt.push(source.splice(index, 1)[0]);
    }
    return dealt;
  }

  function nextGameNumber() {
    stats.gamesStarted += 1;
    saveStats();
    return stats.gamesStarted;
  }

  function randomDealNumber() {
    return Math.floor(Math.random() * MICROSOFT_MAX_DEAL) + 1;
  }

  function randomFromList(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function difficultyLevel() {
    return options.difficulty || "random";
  }

  function difficultyLabel() {
    return {
      random: "Aleatório total",
      level1: "Nível 1 fácil",
      level2: "Nível 2 médio",
      level3: "Nível 3 difícil"
    }[difficultyLevel()] || "Aleatório total";
  }

  function chooseDifficultyDeal() {
    const level = difficultyLevel();
    if (level === "random" || !difficultyReference?.levels) return randomDealNumber();

    const entry = difficultyReference.levels[level];
    if (!entry) return randomDealNumber();

    if (Array.isArray(entry.deals) && entry.deals.length) {
      const allowed = entry.deals.filter((deal) => !UNSOLVABLE_DEALS.has(deal));
      return randomFromList(allowed.length ? allowed : entry.deals);
    }

    if (Array.isArray(entry.ranges) && entry.ranges.length) {
      const excluded = new Set(entry.exclude || []);
      (entry.excludeFromLevels || []).forEach((levelName) => {
        const levelEntry = difficultyReference.levels[levelName];
        (levelEntry?.deals || []).forEach((deal) => excluded.add(deal));
      });
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const range = randomFromList(entry.ranges);
        const deal = Math.floor(Math.random() * (range.to - range.from + 1)) + range.from;
        if (!excluded.has(deal) && !UNSOLVABLE_DEALS.has(deal)) return deal;
      }
    }

    return randomDealNumber();
  }

  function normalizeDealNumber(value) {
    const number = Number.parseInt(String(value).replace(/[^\d-]/g, ""), 10);
    if (!Number.isFinite(number)) return null;
    if (number < 1 || number > MICROSOFT_MAX_DEAL) return null;
    return number;
  }

  function createGame(dealNumber = chooseDifficultyDeal(), gameNumber = nextGameNumber()) {
    const cascades = Array.from({ length: 8 }, () => []);
    const normalizedDeal = normalizeDealNumber(dealNumber) || randomDealNumber();
    const deck = microsoftDeal(normalizedDeal);
    deck.forEach((id, index) => cascades[index % 8].push(id));
    return {
      seed: normalizedDeal,
      dealNumber: normalizedDeal,
      gameNumber,
      startedAt: Date.now(),
      elapsedBeforePause: 0,
      paused: false,
      moves: 0,
      freecells: [null, null, null, null],
      foundations: { S: 0, H: 0, D: 0, C: 0 },
      cascades,
      history: [],
      won: false,
      autoplayUsed: false
    };
  }

  function cloneGame(game) {
    return JSON.parse(JSON.stringify(game));
  }

  function snapshot() {
    const copy = cloneGame(state);
    copy.history = [];
    return copy;
  }

  function pushHistory(label) {
    state.history.push({ label, state: snapshot() });
    if (state.history.length > 220) {
      state.history.shift();
    }
  }

  function loadOptions() {
    try {
      const loaded = { autoPromote: true, nightMode: false, deck: "traditional", difficulty: "random", autoplayUnlocked: false, autoplaySpeed: 2, ...JSON.parse(localStorage.getItem(OPTIONS_KEY) || "{}") };
      if (!["traditional", "ju"].includes(loaded.deck)) loaded.deck = "traditional";
      if (!["random", "level1", "level2", "level3"].includes(loaded.difficulty)) loaded.difficulty = "random";
      if (!Number.isInteger(loaded.autoplaySpeed)) loaded.autoplaySpeed = 2;
      loaded.autoplaySpeed = Math.max(0, Math.min(AUTOPLAY_SPEEDS.length - 1, loaded.autoplaySpeed));
      return loaded;
    } catch {
      return { autoPromote: true, nightMode: false, deck: "traditional", difficulty: "random", autoplayUnlocked: false, autoplaySpeed: 2 };
    }
  }

  function saveOptions() {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
  }

  function loadLegacyBest() {
    try {
      return JSON.parse(localStorage.getItem(BEST_KEY) || "null");
    } catch {
      return null;
    }
  }

  function loadStats() {
    const defaults = {
      gamesStarted: 0,
      gamesFinished: 0,
      finishes: [],
      best: loadLegacyBest()
    };
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(STATS_KEY) || "{}") };
    } catch {
      return defaults;
    }
  }

  function saveStats() {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    localStorage.setItem(BEST_KEY, JSON.stringify(stats.best));
  }

  function isValidGameState(game) {
    if (!game || !Array.isArray(game.cascades) || game.cascades.length !== 8) return false;
    if (!Array.isArray(game.freecells) || game.freecells.length !== 4) return false;
    if (!game.foundations || typeof game.foundations !== "object") return false;

    const visibleCards = [];
    game.cascades.forEach((pile) => {
      if (!Array.isArray(pile)) return;
      visibleCards.push(...pile);
    });
    visibleCards.push(...game.freecells.filter(Boolean));

    const uniqueVisible = new Set(visibleCards);
    if (uniqueVisible.size !== visibleCards.length) return false;
    if (!visibleCards.every((id) => /^[1-9][0-3]?[SHDC]$/.test(id))) return false;

    const foundationCount = SUITS.reduce((sum, suit) => {
      const rank = Number(game.foundations[suit] || 0);
      return sum + Math.max(0, Math.min(13, rank));
    }, 0);

    return visibleCards.length + foundationCount === 52;
  }

  function loadGame() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const loaded = JSON.parse(raw);
      if (!isValidGameState(loaded)) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      if (!loaded.gameNumber) loaded.gameNumber = Math.max(1, stats.gamesStarted || 1);
      if (!loaded.dealNumber) loaded.dealNumber = normalizeDealNumber(loaded.seed) || loaded.gameNumber;
      loaded.seed = loaded.dealNumber;
      if (!Array.isArray(loaded.history)) loaded.history = [];
      if (!Number.isFinite(loaded.startedAt)) loaded.startedAt = Date.now();
      if (!Number.isFinite(loaded.elapsedBeforePause)) loaded.elapsedBeforePause = 0;
      if (typeof loaded.autoplayUsed !== "boolean") loaded.autoplayUsed = false;
      return loaded;
    } catch {
      return null;
    }
  }

  function saveGame() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function elapsedSeconds() {
    if (!state) return 0;
    if (state.won || state.paused) return Math.floor(state.elapsedBeforePause / 1000);
    return Math.floor((state.elapsedBeforePause + Date.now() - state.startedAt) / 1000);
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      const rest = mins % 60;
      return `${hours}:${String(rest).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function updateTimer() {
    els.timer.textContent = formatTime(elapsedSeconds());
  }

  function startTimer() {
    clearInterval(timerHandle);
    timerHandle = setInterval(() => {
      updateTimer();
      saveGame();
    }, 1000);
    updateTimer();
  }

  function cardsInFoundations() {
    return Object.values(state.foundations).reduce((sum, value) => sum + value, 0);
  }

  function averageLastFive() {
    const last = stats.finishes.slice(-5);
    if (!last.length) return null;
    const total = last.reduce((sum, item) => sum + item.seconds, 0);
    return Math.round(total / last.length);
  }

  function findCard(id) {
    for (let i = 0; i < state.freecells.length; i += 1) {
      if (state.freecells[i] === id) return { type: "freecell", index: i, cardIndex: 0 };
    }
    for (let i = 0; i < state.cascades.length; i += 1) {
      const cardIndex = state.cascades[i].indexOf(id);
      if (cardIndex !== -1) return { type: "cascade", index: i, cardIndex };
    }
    return null;
  }

  function sourceCards(source) {
    if (source.type === "freecell") return [state.freecells[source.index]];
    return state.cascades[source.index].slice(source.cardIndex);
  }

  function isDescendingAlternating(cards) {
    for (let i = 0; i < cards.length - 1; i += 1) {
      const upper = parseCard(cards[i]);
      const lower = parseCard(cards[i + 1]);
      if (upper.rank !== lower.rank + 1 || upper.color === lower.color) return false;
    }
    return true;
  }

  function maxMovableCards(destinationCascadeIndex) {
    const emptyFreecells = state.freecells.filter((card) => !card).length;
    const emptyCascades = state.cascades.filter((pile, index) => pile.length === 0 && index !== destinationCascadeIndex).length;
    return (emptyFreecells + 1) * (2 ** emptyCascades);
  }

  function canPlaceOnCascade(cards, cascadeIndex) {
    if (!cards.length || !isDescendingAlternating(cards)) return false;
    if (cards.length > maxMovableCards(cascadeIndex)) return false;
    const pile = state.cascades[cascadeIndex];
    if (!pile.length) return true;
    const moving = parseCard(cards[0]);
    const target = parseCard(pile[pile.length - 1]);
    return target.rank === moving.rank + 1 && target.color !== moving.color;
  }

  function canMoveToFoundation(id) {
    const card = parseCard(id);
    return state.foundations[card.suit] === card.rank - 1;
  }

  function canAutoPromote(id) {
    if (!canMoveToFoundation(id)) return false;
    const card = parseCard(id);
    if (card.rank <= 2) return true;
    const oppositeSuits = card.color === "red" ? ["S", "C"] : ["H", "D"];
    const minOpposite = Math.min(...oppositeSuits.map((suit) => state.foundations[suit]));
    return card.rank <= minOpposite + 1;
  }

  function removeFromSource(source, count) {
    if (source.type === "freecell") {
      const cards = [state.freecells[source.index]];
      state.freecells[source.index] = null;
      return cards;
    }
    return state.cascades[source.index].splice(source.cardIndex, count);
  }

  function placeCards(cards, target) {
    if (target.type === "freecell") {
      state.freecells[target.index] = cards[0];
      return;
    }
    if (target.type === "foundation") {
      const card = parseCard(cards[0]);
      state.foundations[card.suit] = card.rank;
      return;
    }
    state.cascades[target.index].push(...cards);
  }

  function canMove(source, target) {
    if (!source || !target) return false;
    if (source.type === target.type && source.index === target.index) return false;
    const cards = sourceCards(source);
    if (!cards[0]) return false;

    if (target.type === "freecell") {
      return cards.length === 1 && !state.freecells[target.index];
    }
    if (target.type === "foundation") {
      return cards.length === 1 && canMoveToFoundation(cards[0]) && parseCard(cards[0]).suit === target.suit;
    }
    return canPlaceOnCascade(cards, target.index);
  }

  function move(source, target, label = "move", recordHistory = true) {
    if (!canMove(source, target)) return false;
    const cards = sourceCards(source);
    if (recordHistory) pushHistory(label);
    const moved = removeFromSource(source, cards.length);
    placeCards(moved, target);
    state.moves += 1;
    selected = null;
    if (recordHistory && options.autoPromote) {
      runAutoPromote(false);
    }
    afterChange();
    return true;
  }

  function moveWithoutAutoPromote(source, target, label = "move", recordHistory = true) {
    const previous = options.autoPromote;
    options.autoPromote = false;
    const moved = move(source, target, label, recordHistory);
    options.autoPromote = previous;
    return moved;
  }

  function targetFromElement(element) {
    const target = element?.closest?.("[data-target-type]");
    if (!target) return null;
    const type = target.dataset.targetType;
    if (type === "cascade") return { type, index: Number(target.dataset.targetIndex) };
    if (type === "freecell") return { type, index: Number(target.dataset.targetIndex) };
    if (type === "foundation") return { type, suit: target.dataset.suit };
    return null;
  }

  function clearDropReady() {
    document.querySelectorAll(".drop-ready").forEach((node) => node.classList.remove("drop-ready"));
  }

  function updateDragGhost(clientX, clientY) {
    if (!drag?.ghost) return;
    drag.ghost.style.transform = `translate3d(${clientX - drag.offsetX}px, ${clientY - drag.offsetY}px, 0)`;
  }

  function createDragGhost(source, originCard, clientX, clientY) {
    const cards = sourceCards(source);
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    const rect = originCard.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--stack-gap")) || 28;

    cards.forEach((id, index) => {
      const node = document.querySelector(`.card[data-card="${CSS.escape(id)}"]`);
      if (!node) return;
      const clone = node.cloneNode(true);
      clone.classList.remove("selected");
      clone.style.top = `${index * gap}px`;
      clone.style.zIndex = String(300 + index);
      ghost.append(clone);
    });

    document.body.append(ghost);
    drag.offsetX = clientX - rect.left;
    drag.offsetY = clientY - rect.top;
    drag.ghost = ghost;
    updateDragGhost(clientX, clientY);
  }

  function beginDrag(event, id, point = event, owner = event.currentTarget) {
    if (drag) return;
    const source = findCard(id);
    if (!source) return;
    const cards = sourceCards(source);
    const clickedIndex = cards.indexOf(id);
    if (source.type === "cascade" && clickedIndex > 0) {
      source.cardIndex += clickedIndex;
    }
    if (source.type === "cascade" && !isDescendingAlternating(sourceCards(source))) {
      return;
    }
    drag = {
      id,
      source,
      startX: point.clientX,
      startY: point.clientY,
      currentX: point.clientX,
      currentY: point.clientY,
      offsetX: 0,
      offsetY: 0,
      active: false,
      ghost: null,
      pointerId: event.pointerId,
      pointerOwner: owner,
      lastTargetElement: null
    };
    try {
      owner?.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is a convenience; mouse/touch fallbacks keep drag working without it.
    }
    drag.active = true;
    selected = drag.source;
    renderSelection();
    sourceCards(drag.source).forEach((cardIdValue) => {
      document.querySelector(`.card[data-card="${CSS.escape(cardIdValue)}"]`)?.classList.add("dragging");
    });
    createDragGhost(drag.source, owner, point.clientX, point.clientY);
    setStatus("Arrastando carta...");
    event.preventDefault();
  }

  function cardFromEvent(event) {
    const card = event.target?.closest?.(".card[data-card]");
    return card || null;
  }

  function onDragPointerStart(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const card = cardFromEvent(event);
    if (!card) return;
    beginDrag(event, card.dataset.card, event, card);
  }

  function onDragMouseStart(event) {
    if (event.button !== 0) return;
    const card = cardFromEvent(event);
    if (!card) return;
    beginDrag(event, card.dataset.card, event, card);
  }

  function onDragTouchStart(event) {
    const card = cardFromEvent(event);
    const point = pointFromTouch(event);
    if (!card || !point) return;
    beginDrag(event, card.dataset.card, point, card);
  }

  function continueDrag(point, originalEvent) {
    if (!drag) return;
    drag.currentX = point.clientX;
    drag.currentY = point.clientY;
    const distance = Math.hypot(point.clientX - drag.startX, point.clientY - drag.startY);
    if (!drag.active && distance > 8) {
      const originCard = document.querySelector(`.card[data-card="${CSS.escape(drag.id)}"]`);
      if (!originCard) return;
      drag.active = true;
      selected = drag.source;
      renderSelection();
      sourceCards(drag.source).forEach((id) => {
        document.querySelector(`.card[data-card="${CSS.escape(id)}"]`)?.classList.add("dragging");
      });
      createDragGhost(drag.source, originCard, point.clientX, point.clientY);
      setStatus("Arraste ate o destino.");
    }

    if (!drag.active) return;
    originalEvent.preventDefault();
    updateDragGhost(point.clientX, point.clientY);
    drag.ghost.hidden = true;
    const element = document.elementFromPoint(point.clientX, point.clientY);
    drag.ghost.hidden = false;
    const targetElement = element?.closest?.("[data-target-type]");
    if (targetElement !== drag.lastTargetElement) {
      clearDropReady();
      targetElement?.classList.add("drop-ready");
      drag.lastTargetElement = targetElement;
    }
  }

  function pointFromTouch(event) {
    const touch = event.touches?.[0] || event.changedTouches?.[0];
    return touch ? { clientX: touch.clientX, clientY: touch.clientY } : null;
  }

  function onPointerMove(event) {
    continueDrag(event, event);
  }

  function onMouseMove(event) {
    if (!drag) return;
    continueDrag(event, event);
  }

  function onTouchMove(event) {
    const point = pointFromTouch(event);
    if (point) continueDrag(point, event);
  }

  function endDrag(event) {
    if (!drag) return;
    const wasActive = drag.active;
    const source = drag.source;
    try {
      drag.pointerOwner?.releasePointerCapture?.(drag.pointerId);
    } catch {
      // Capture may already be gone if the browser cancelled the pointer.
    }
    if (wasActive) {
      event.preventDefault();
      const point = pointFromTouch(event) || event;
      const x = Number.isFinite(point.clientX) ? point.clientX : drag.currentX;
      const y = Number.isFinite(point.clientY) ? point.clientY : drag.currentY;
      const distance = Math.hypot(x - drag.startX, y - drag.startY);
      if (distance < 8) {
        drag.ghost?.remove();
        clearDropReady();
        document.querySelectorAll(".dragging").forEach((node) => node.classList.remove("dragging"));
        selected = null;
        renderSelection();
        const clickedId = drag.id;
        drag = null;
        onCardClick(clickedId);
        return;
      }
      suppressClickUntil = Date.now() + 350;
      drag.ghost.hidden = true;
      const element = document.elementFromPoint(x, y);
      const target = targetFromElement(element);
      drag.ghost.remove();
      clearDropReady();
      document.querySelectorAll(".dragging").forEach((node) => node.classList.remove("dragging"));
      if (target && move(source, target, "drag")) {
        setStatus("Movimento feito.");
      } else {
        selected = null;
        renderSelection();
        setStatus("Movimento inválido.");
      }
    }
    drag = null;
  }

  function topMovableCards() {
    const cards = [];
    state.freecells.forEach((id, index) => {
      if (id) cards.push({ id, source: { type: "freecell", index, cardIndex: 0 } });
    });
    state.cascades.forEach((pile, index) => {
      if (pile.length) cards.push({ id: pile[pile.length - 1], source: { type: "cascade", index, cardIndex: pile.length - 1 } });
    });
    return cards;
  }

  function runAutoPromote(createHistory = true) {
    let promoted = false;
    let changed = true;
    if (createHistory) pushHistory("auto-promote");

    while (changed) {
      changed = false;
      for (const item of topMovableCards()) {
        if (!canAutoPromote(item.id)) continue;
        const card = parseCard(item.id);
        const freshSource = findCard(item.id);
        if (!freshSource) continue;
        removeFromSource(freshSource, 1);
        state.foundations[card.suit] = card.rank;
        promoted = true;
        changed = true;
      }
    }

    if (!promoted && createHistory) {
      state.history.pop();
    }
    return promoted;
  }

  function sourceName(source) {
    return source.type === "freecell" ? `F${source.index + 1}` : `C${source.index + 1}`;
  }

  function targetName(target) {
    if (target.type === "freecell") return `F${target.index + 1}`;
    if (target.type === "foundation") return `Base ${target.suit}`;
    return `C${target.index + 1}`;
  }

  function solverClone(board) {
    return {
      freecells: board.freecells.slice(),
      foundations: { ...board.foundations },
      cascades: board.cascades.map((pile) => pile.slice())
    };
  }

  function solverInitialBoard() {
    return solverClone(state);
  }

  function solverKey(board) {
    const cells = board.freecells.map((card) => card || "--").sort().join(",");
    const foundations = SUITS.map((suit) => board.foundations[suit]).join(",");
    const cascades = board.cascades.map((pile) => pile.join(".")).sort().join("|");
    return `${foundations}/${cells}/${cascades}`;
  }

  function solverWon(board) {
    return Object.values(board.foundations).reduce((sum, value) => sum + value, 0) === 52;
  }

  function solverTopCards(board) {
    const cards = [];
    board.freecells.forEach((id, index) => {
      if (id) cards.push({ id, source: { type: "freecell", index, cardIndex: 0, card: id } });
    });
    board.cascades.forEach((pile, index) => {
      if (pile.length) {
        const id = pile[pile.length - 1];
        cards.push({ id, source: { type: "cascade", index, cardIndex: pile.length - 1, card: id } });
      }
    });
    return cards;
  }

  function solverSourceCards(board, source) {
    if (source.type === "freecell") return [board.freecells[source.index]];
    return board.cascades[source.index].slice(source.cardIndex);
  }

  function solverMaxMovable(board, destinationCascadeIndex) {
    const emptyFreecells = board.freecells.filter((card) => !card).length;
    const emptyCascades = board.cascades.filter((pile, index) => pile.length === 0 && index !== destinationCascadeIndex).length;
    return (emptyFreecells + 1) * (2 ** emptyCascades);
  }

  function solverCanCascade(board, cards, cascadeIndex) {
    if (!cards.length || !isDescendingAlternating(cards)) return false;
    if (cards.length > solverMaxMovable(board, cascadeIndex)) return false;
    const pile = board.cascades[cascadeIndex];
    if (!pile.length) return true;
    const moving = parseCard(cards[0]);
    const target = parseCard(pile[pile.length - 1]);
    return target.rank === moving.rank + 1 && target.color !== moving.color;
  }

  function solverCanFoundation(board, id, suit) {
    const card = parseCard(id);
    return card.suit === suit && board.foundations[card.suit] === card.rank - 1;
  }

  function solverCanMove(board, source, target) {
    const cards = solverSourceCards(board, source);
    if (!cards[0]) return false;
    if (target.type === "freecell") return cards.length === 1 && !board.freecells[target.index];
    if (target.type === "foundation") return cards.length === 1 && solverCanFoundation(board, cards[0], target.suit);
    if (source.type === "cascade" && source.index === target.index) return false;
    return solverCanCascade(board, cards, target.index);
  }

  function solverApply(board, moveOption) {
    const next = solverClone(board);
    const cards = solverSourceCards(next, moveOption.source);
    const moved = moveOption.source.type === "freecell"
      ? [next.freecells.splice(moveOption.source.index, 1, null)[0]]
      : next.cascades[moveOption.source.index].splice(moveOption.source.cardIndex, cards.length);
    if (moveOption.target.type === "freecell") {
      next.freecells[moveOption.target.index] = moved[0];
    } else if (moveOption.target.type === "foundation") {
      const card = parseCard(moved[0]);
      next.foundations[card.suit] = card.rank;
    } else {
      next.cascades[moveOption.target.index].push(...moved);
    }
    return next;
  }

  function solverMoveScore(board, moveOption) {
    const cards = solverSourceCards(board, moveOption.source);
    const moving = parseCard(cards[0]);
    let score = 0;
    if (moveOption.target.type === "foundation") score += 10000 + moving.rank * 20;
    if (moveOption.source.type === "freecell") score += 600;
    if (moveOption.source.type === "cascade" && moveOption.source.cardIndex > 0) score += 250;
    if (moveOption.target.type === "cascade") {
      const pile = board.cascades[moveOption.target.index];
      score += cards.length * 80;
      if (!pile.length) score += cards.length > 1 || moving.rank >= 11 ? 220 : -180;
    }
    if (moveOption.target.type === "freecell") score -= 250;
    score += Object.values(solverApply(board, moveOption).foundations).reduce((sum, rank) => sum + rank, 0) * 5;
    return score;
  }

  function solverLegalMoves(board) {
    const moves = [];
    for (const item of solverTopCards(board)) {
      const card = parseCard(item.id);
      const target = { type: "foundation", suit: card.suit };
      if (solverCanMove(board, item.source, target)) moves.push({ source: item.source, target });
    }

    board.freecells.forEach((id, cellIndex) => {
      if (!id) return;
      const source = { type: "freecell", index: cellIndex, cardIndex: 0, card: id };
      for (let cascadeIndex = 0; cascadeIndex < 8; cascadeIndex += 1) {
        const target = { type: "cascade", index: cascadeIndex };
        if (solverCanMove(board, source, target)) moves.push({ source, target });
      }
    });

    board.cascades.forEach((pile, cascadeIndex) => {
      for (let cardIndex = 0; cardIndex < pile.length; cardIndex += 1) {
        const source = { type: "cascade", index: cascadeIndex, cardIndex, card: pile[cardIndex] };
        const cards = solverSourceCards(board, source);
        if (!isDescendingAlternating(cards)) continue;
        for (let targetIndex = 0; targetIndex < 8; targetIndex += 1) {
          const target = { type: "cascade", index: targetIndex };
          if (solverCanMove(board, source, target)) moves.push({ source, target });
        }
      }
      if (!pile.length) return;
      const source = { type: "cascade", index: cascadeIndex, cardIndex: pile.length - 1, card: pile[pile.length - 1] };
      board.freecells.forEach((id, cellIndex) => {
        const target = { type: "freecell", index: cellIndex };
        if (!id && solverCanMove(board, source, target)) moves.push({ source, target });
      });
    });

    return moves.sort((a, b) => solverMoveScore(board, b) - solverMoveScore(board, a));
  }

  function resolvePlannedMove(planned) {
    const source = planned.source.type === "freecell"
      ? { type: "freecell", index: planned.source.index, cardIndex: 0 }
      : findCard(planned.source.card);
    if (!source) return null;
    if (planned.source.type === "cascade" && source.type === "cascade") {
      source.cardIndex = state.cascades[source.index].indexOf(planned.source.card);
    }
    return { source, target: planned.target };
  }

  function findAutoplayPlan(onDone) {
    const startBoard = solverInitialBoard();
    const visited = new Set([solverKey(startBoard)]);
    const stack = [{ board: startBoard, moves: solverLegalMoves(startBoard), nextIndex: 0, path: [] }];
    const maxVisited = 3000000;
    let processed = 0;

    function searchChunk() {
      if (!autoplayRunning) return;
      const chunkLimit = processed + 4500;
      while (stack.length && processed < chunkLimit && visited.size < maxVisited) {
        const frame = stack[stack.length - 1];
        if (solverWon(frame.board)) {
          onDone(frame.path);
          return;
        }
        if (frame.nextIndex >= frame.moves.length) {
          stack.pop();
          continue;
        }
        const moveOption = frame.moves[frame.nextIndex];
        frame.nextIndex += 1;
        const next = solverApply(frame.board, moveOption);
        const key = solverKey(next);
        if (visited.has(key)) continue;
        visited.add(key);
        processed += 1;
        stack.push({
          board: next,
          moves: solverLegalMoves(next),
          nextIndex: 0,
          path: frame.path.concat(moveOption)
        });
      }

      if (visited.size >= maxVisited || !stack.length) {
        stopAutoplay(false);
        setStatus("Autoplay não encontrou uma solução dentro do limite local.");
        return;
      }

      setStatus(`Autoplay calculando solução... ${visited.size.toLocaleString("pt-BR")} posições`);
      solverTimer = setTimeout(searchChunk, 0);
    }

    searchChunk();
  }

  function scheduleAutoplay() {
    clearTimeout(autoplayTimer);
    if (!autoplayRunning) return;
    autoplayTimer = setTimeout(autoplayStep, AUTOPLAY_SPEEDS[options.autoplaySpeed]);
  }

  function autoplayStep() {
    if (!autoplayRunning || state.won) {
      stopAutoplay(false);
      return;
    }
    state.autoplayUsed = true;

    const planned = autoplayPlan.shift();
    if (!planned) {
      stopAutoplay(false);
      setStatus("Autoplay terminou o plano antes da vitória.");
      return;
    }

    const resolved = resolvePlannedMove(planned);
    if (resolved && moveWithoutAutoPromote(resolved.source, resolved.target, "autoplay")) {
      setStatus(`Autoplay: ${sourceName(resolved.source)} → ${targetName(resolved.target)}.`);
    } else {
      stopAutoplay(false);
      setStatus("Autoplay pausado: o plano mudou após jogadas manuais.");
      return;
    }
    scheduleAutoplay();
  }

  function startAutoplay() {
    if (state.won) return;
    if (UNSOLVABLE_DEALS.has(state.dealNumber || state.seed)) {
      setStatus(`Jogo #${state.dealNumber || state.seed} é conhecido como impossível.`);
      return;
    }
    autoplayRunning = true;
    state.autoplayUsed = true;
    autoplayPlan = [];
    saveGame();
    render();
    setStatus("Autoplay calculando solução...");
    findAutoplayPlan((plan) => {
      if (!autoplayRunning) return;
      autoplayPlan = plan;
      setStatus(`Autoplay iniciou plano com ${plan.length} movimentos.`);
      scheduleAutoplay();
    });
  }

  function stopAutoplay(showMessage = true) {
    autoplayRunning = false;
    clearTimeout(autoplayTimer);
    clearTimeout(solverTimer);
    autoplayTimer = null;
    solverTimer = null;
    autoplayPlan = [];
    render();
    if (showMessage) setStatus("Autoplay parado. Você pode continuar manualmente.");
  }

  function toggleAutoplay() {
    if (autoplayRunning) {
      stopAutoplay();
    } else {
      els.menu.open = false;
      startAutoplay();
    }
  }

  function toggleAutoplayUnlock() {
    options.autoplayUnlocked = !options.autoplayUnlocked;
    if (!options.autoplayUnlocked) stopAutoplay(false);
    saveOptions();
    render();
    setStatus(options.autoplayUnlocked ? "Opção secreta ativada." : "Opção secreta desativada.");
  }

  function changeAutoplaySpeed(delta) {
    options.autoplaySpeed = Math.max(0, Math.min(AUTOPLAY_SPEEDS.length - 1, options.autoplaySpeed + delta));
    saveOptions();
    render();
    if (autoplayRunning) {
      setStatus(`Velocidade autoplay: ${options.autoplaySpeed + 1}/${AUTOPLAY_SPEEDS.length}.`);
      scheduleAutoplay();
    }
  }

  function autoMoveCard(source) {
    const cards = sourceCards(source);
    if (cards.length !== 1) return false;
    const card = parseCard(cards[0]);
    if (canMove(source, { type: "foundation", suit: card.suit })) {
      return move(source, { type: "foundation", suit: card.suit }, "foundation");
    }
    const emptyFreecell = state.freecells.findIndex((value) => !value);
    if (source.type !== "freecell" && emptyFreecell !== -1) {
      return move(source, { type: "freecell", index: emptyFreecell }, "freecell");
    }
    return false;
  }

  function trySmartMove(source) {
    const cards = sourceCards(source);
    if (!cards.length) return false;
    if (cards.length === 1 && autoMoveCard(source)) return true;
    for (let i = 0; i < state.cascades.length; i += 1) {
      if (source.type === "cascade" && source.index === i) continue;
      if (canMove(source, { type: "cascade", index: i })) {
        return move(source, { type: "cascade", index: i }, "cascade");
      }
    }
    return false;
  }

  function cardAsset(id) {
    const card = parseCard(id);
    return `assets/decks/${options.deck}/${card.rank}${card.suit}.svg`;
  }

  function createCardButton(id, source, top) {
    const card = parseCard(id);
    const button = document.createElement("button");
    button.className = `card ${card.color}`;
    button.type = "button";
    button.dataset.card = id;
    button.dataset.sourceType = source.type;
    button.dataset.sourceIndex = String(source.index);
    button.dataset.cardIndex = String(source.cardIndex);
    button.style.top = `${top}px`;
    button.style.zIndex = String(10 + source.cardIndex);
    button.setAttribute("aria-label", `${RANKS[card.rank]} de ${SUIT_NAMES[card.suit]}`);

    const fallback = document.createElement("span");
    fallback.className = "card-fallback";
    fallback.innerHTML = `<span class="card-corner"><span>${RANKS[card.rank]}</span><span>${SUIT_SYMBOLS[card.suit]}</span></span><span class="card-center">${SUIT_SYMBOLS[card.suit]}</span><span class="card-corner bottom"><span>${RANKS[card.rank]}</span><span>${SUIT_SYMBOLS[card.suit]}</span></span>`;
    button.append(fallback);

    const img = document.createElement("img");
    img.src = cardAsset(id);
    img.alt = card.label;
    img.draggable = false;
    img.loading = "eager";
    button.append(img);

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (Date.now() < suppressClickUntil) return;
      onCardClick(id);
    });
    return button;
  }

  function makeTargetElement(className, label, onClick) {
    const element = document.createElement("div");
    element.className = className;
    element.tabIndex = 0;
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", label);
    if (className.includes("cascade")) {
      element.dataset.targetType = "cascade";
      element.dataset.targetIndex = label.match(/\d+$/)?.[0] ? String(Number(label.match(/\d+$/)[0]) - 1) : "0";
    }
    element.addEventListener("click", onClick);
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onClick();
      }
    });
    return element;
  }

  function renderTop() {
    els.freecells.innerHTML = "";
    state.freecells.forEach((id, index) => {
      const slot = makeTargetElement(
        "slot freecell empty-target",
        `Célula livre ${index + 1}`,
        () => onTargetClick({ type: "freecell", index })
      );
      slot.dataset.targetType = "freecell";
      slot.dataset.targetIndex = String(index);
      slot.style.gridColumn = String(index + 1);
      if (id) {
        slot.append(createCardButton(id, { type: "freecell", index, cardIndex: 0 }, 0));
      }
      els.freecells.append(slot);
    });

    els.foundations.innerHTML = "";
    SUITS.forEach((suit) => {
      const slot = makeTargetElement(
        "slot foundation empty-target",
        `Fundação de ${SUIT_NAMES[suit]}`,
        () => onTargetClick({ type: "foundation", suit })
      );
      slot.dataset.suit = suit;
      slot.dataset.targetType = "foundation";
      slot.style.gridColumn = String(indexForSuit(suit) + 6);
      const rank = state.foundations[suit];
      if (rank > 0) {
        slot.append(createCardButton(cardId(suit, rank), { type: "foundation", index: 0, cardIndex: 0 }, 0));
      }
      els.foundations.append(slot);
    });
  }

  function renderCascades() {
    els.cascades.innerHTML = "";
    const gap = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--stack-gap")) || 28;
    const cardHeight = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--card-h")) || 120;

    state.cascades.forEach((pile, pileIndex) => {
      const column = makeTargetElement(
        "cascade empty-target",
        `Coluna ${pileIndex + 1}`,
        () => onTargetClick({ type: "cascade", index: pileIndex })
      );
      column.style.minHeight = `${cardHeight + Math.max(7, pile.length - 1) * gap}px`;
      column.dataset.targetType = "cascade";
      column.dataset.targetIndex = String(pileIndex);
      pile.forEach((id, cardIndex) => {
        column.append(createCardButton(id, { type: "cascade", index: pileIndex, cardIndex }, cardIndex * gap));
      });
      els.cascades.append(column);
    });
  }

  function renderSelection() {
    document.querySelectorAll(".card.selected").forEach((node) => node.classList.remove("selected"));
    document.querySelectorAll(".card.hint").forEach((node) => node.classList.remove("hint"));
    if (!selected) return;
    const source = selected;
    const cards = sourceCards(source);
    cards.forEach((id) => {
      const node = document.querySelector(`.card[data-card="${CSS.escape(id)}"]`);
      if (node) node.classList.add("selected");
    });
  }

  function render() {
    renderTop();
    renderCascades();
    renderSelection();
    els.dealNumber.textContent = `#${state.dealNumber || state.seed}`;
    els.cardsLeft.textContent = String(52 - cardsInFoundations());
    const bestText = stats.best ? formatTime(stats.best.seconds) : "--:--";
    const averageText = averageLastFive() === null ? "--:--" : formatTime(averageLastFive());
    els.bestTime.textContent = bestText;
    els.avgTime.textContent = averageText;
    els.gameInfo.textContent = `Jogo #${state.dealNumber || state.seed} · ${state.moves} movimentos · ${stats.gamesFinished} concluídos`;
    els.infoDeal.textContent = `#${state.dealNumber || state.seed}`;
    els.infoMoves.textContent = String(state.moves);
    els.infoFinished.textContent = String(stats.gamesFinished);
    els.infoDifficulty.textContent = difficultyLabel();
    els.infoBest.textContent = bestText;
    els.infoAverage.textContent = averageText;
    els.quickUndoBtn.disabled = state.history.length === 0;
    els.autoplayBtn.hidden = !options.autoplayUnlocked;
    els.autoplayBtn.textContent = autoplayRunning ? "Stop autoplay" : "Autoplay";
    els.slowerBtn.hidden = !autoplayRunning;
    els.fasterBtn.hidden = !autoplayRunning;
    els.slowerBtn.disabled = options.autoplaySpeed === 0;
    els.fasterBtn.disabled = options.autoplaySpeed === AUTOPLAY_SPEEDS.length - 1;
    els.autoPromoteToggle.checked = options.autoPromote;
    els.nightModeToggle.checked = !!options.nightMode;
    document.body.classList.toggle("night-mode", !!options.nightMode);
    els.difficultySelect.value = difficultyLevel();
    els.deckSelect.value = options.deck;
    updateTimer();
  }

  function renderSoon() {
    if (drag) return;
    window.requestAnimationFrame(() => {
      if (drag) return;
      render();
      window.requestAnimationFrame(() => {
        if (!drag) render();
      });
    });
  }

  function onCardClick(id) {
    const now = Date.now();
    const source = findCard(id);
    if (!source) return;
    const cards = sourceCards(source);
    const clickedIndex = cards.indexOf(id);
    if (source.type === "cascade" && clickedIndex > 0) {
      source.cardIndex += clickedIndex;
    }

    if (lastTap.id === id && now - lastTap.time < 360) {
      lastTap = { id: null, time: 0 };
      const topSource = findCard(id);
      if (topSource && sourceCards(topSource).length === 1) {
        const card = parseCard(id);
        if (move(topSource, { type: "foundation", suit: card.suit }, "foundation")) {
          setStatus(`${card.label} foi para a fundação.`);
          return;
        }
        const freeIndex = state.freecells.findIndex((value) => !value);
        if (freeIndex !== -1 && move(topSource, { type: "freecell", index: freeIndex }, "freecell")) {
          setStatus(`${card.label} foi para a célula livre.`);
          return;
        }
      }
    }
    lastTap = { id, time: now };

    if (selected) {
      const targetSource = source;
      if (tryTargetFromCard(targetSource)) return;
    }

    if (source.type === "cascade" && !isDescendingAlternating(sourceCards(source))) {
      setStatus("Essa sequência não pode ser movida junta.");
      selected = null;
      renderSelection();
      return;
    }

    selected = source;
    renderSelection();
    setStatus("Carta selecionada. Toque no destino.");
  }

  function tryTargetFromCard(targetSource) {
    if (!selected) return false;
    if (targetSource.type === "cascade") {
      const moved = move(selected, { type: "cascade", index: targetSource.index }, "cascade");
      if (moved) {
        setStatus("Movimento feito.");
        return true;
      }
    }
    setStatus("Movimento inválido.");
    selected = null;
    renderSelection();
    return false;
  }

  function onTargetClick(target) {
    if (!selected) return;
    if (move(selected, target, "move")) {
      setStatus("Movimento feito.");
    } else {
      setStatus("Movimento inválido.");
      selected = null;
      renderSelection();
    }
  }

  function setStatus(message) {
    els.statusLine.textContent = message;
  }

  function afterChange() {
    checkWin();
    saveGame();
    render();
  }

  function checkWin() {
    if (cardsInFoundations() !== 52 || state.won) return;
    state.elapsedBeforePause = elapsedSeconds() * 1000;
    state.won = true;
    clearInterval(timerHandle);
    const seconds = elapsedSeconds();
    stopAutoplay(false);
    if (!state.autoplayUsed) {
      stats.gamesFinished += 1;
      stats.finishes.push({ seconds, seed: state.seed, dealNumber: state.dealNumber, gameNumber: state.gameNumber, date: new Date().toISOString() });
      stats.finishes = stats.finishes.slice(-25);
      if (!stats.best || seconds < stats.best.seconds) {
        stats.best = { seconds, seed: state.seed, dealNumber: state.dealNumber, gameNumber: state.gameNumber, date: new Date().toISOString() };
      }
      saveStats();
    }
    showWin(seconds);
  }

  function showWin(seconds) {
    const suffix = state.autoplayUsed ? " · autoplay usado, não conta para recorde" : "";
    els.winText.textContent = `Tempo: ${formatTime(seconds)} · ${state.moves} movimentos${suffix}`;
    els.winOverlay.hidden = false;
  }

  function undo() {
    const item = state.history.pop();
    if (!item) return;
    const history = state.history;
    state = item.state;
    state.history = history;
    selected = null;
    saveGame();
    render();
    setStatus("Última ação desfeita.");
  }

  function startNewGame(dealNumber, gameNumber) {
    stopAutoplay(false);
    state = createGame(dealNumber, gameNumber);
    selected = null;
    els.winOverlay.hidden = true;
    saveGame();
    render();
    startTimer();
    setStatus("Novo jogo iniciado.");
  }

  function restartGame() {
    startNewGame(state.dealNumber || state.seed, state.gameNumber);
  }

  async function loadDifficultyReference() {
    try {
      const response = await fetch("assets/freecell-difficulty.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      difficultyReference = await response.json();
    } catch {
      difficultyReference = null;
      if (difficultyLevel() !== "random") {
        setStatus("Lista de dificuldade não carregou; novo jogo usará aleatório total.");
      }
    }
  }

  function selectGameByPrompt() {
    const current = state.dealNumber || state.seed || 1;
    const answer = window.prompt(`Digite o número do jogo (1-${MICROSOFT_MAX_DEAL}):`, String(current));
    if (answer === null) return;
    const dealNumber = normalizeDealNumber(answer);
    if (!dealNumber) {
      setStatus(`Número inválido. Use 1 até ${MICROSOFT_MAX_DEAL}.`);
      return;
    }
    els.menu.open = false;
    startNewGame(dealNumber);
    setStatus(`Jogo #${dealNumber} carregado.`);
  }

  function wireEvents() {
    els.menuSummary.addEventListener("pointerdown", () => {
      longPressTriggered = false;
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        longPressTriggered = true;
        toggleAutoplayUnlock();
      }, 5000);
    });
    els.menuSummary.addEventListener("pointerup", (event) => {
      clearTimeout(longPressTimer);
      if (longPressTriggered) {
        event.preventDefault();
        els.menu.open = false;
      }
    });
    els.menuSummary.addEventListener("pointercancel", () => clearTimeout(longPressTimer));
    els.menuSummary.addEventListener("click", (event) => {
      if (longPressTriggered) {
        event.preventDefault();
        longPressTriggered = false;
      }
    });
    els.newGameBtn.addEventListener("click", () => {
      els.menu.open = false;
      startNewGame();
    });
    els.selectGameBtn.addEventListener("click", selectGameByPrompt);
    els.restartBtn.addEventListener("click", () => {
      els.menu.open = false;
      restartGame();
    });
    els.quickUndoBtn.addEventListener("click", undo);
    els.autoplayBtn.addEventListener("click", toggleAutoplay);
    els.slowerBtn.addEventListener("click", () => changeAutoplaySpeed(-1));
    els.fasterBtn.addEventListener("click", () => changeAutoplaySpeed(1));
    els.autoPromoteToggle.addEventListener("change", () => {
      options.autoPromote = els.autoPromoteToggle.checked;
      saveOptions();
      if (options.autoPromote && runAutoPromote(true)) {
        afterChange();
        setStatus("Auto-promoção aplicada.");
      }
    });
    els.nightModeToggle.addEventListener("change", () => {
      options.nightMode = els.nightModeToggle.checked;
      saveOptions();
      render();
    });
    els.difficultySelect.addEventListener("change", () => {
      options.difficulty = els.difficultySelect.value;
      saveOptions();
      const label = els.difficultySelect.selectedOptions[0]?.textContent || "Aleatório total";
      setStatus(`Novo jogo usará: ${label}.`);
    });
    els.deckSelect.addEventListener("change", () => {
      options.deck = els.deckSelect.value;
      saveOptions();
      render();
    });
    els.winNewGameBtn.addEventListener("click", () => startNewGame());
    window.addEventListener("resize", renderSoon);
    window.addEventListener("load", renderSoon, { once: true });
    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(renderSoon);
      observer.observe(els.table);
      observer.observe(document.documentElement);
    }
    els.table.addEventListener("contextmenu", (event) => event.preventDefault());
    els.table.addEventListener("selectstart", (event) => event.preventDefault());
    els.table.addEventListener("dragstart", (event) => event.preventDefault());
    document.addEventListener("pointerdown", onDragPointerStart, { capture: true, passive: false });
    document.addEventListener("mousedown", onDragMouseStart, { capture: true, passive: false });
    document.addEventListener("touchstart", onDragTouchStart, { capture: true, passive: false });
    window.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", endDrag, { capture: true });
    window.addEventListener("pointercancel", endDrag, { capture: true });
    window.addEventListener("mousemove", onMouseMove, { capture: true, passive: false });
    window.addEventListener("mouseup", endDrag, { capture: true });
    window.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    window.addEventListener("touchend", endDrag, { capture: true, passive: false });
    window.addEventListener("touchcancel", endDrag, { capture: true, passive: false });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        saveGame();
      } else {
        render();
      }
    });
  }

  function init() {
    state = loadGame() || createGame();
    wireEvents();
    render();
    renderSoon();
    loadDifficultyReference();
    startTimer();
  }

  init();
})();
