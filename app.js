const API_BASE = "https://api.scryfall.com";

const CACHE_KEY = "mtg-bulk-scout-card-cache-v2";
const SETTINGS_KEY = "mtg-bulk-scout-settings-v2";

const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Deliberately below Scryfall's stated request-rate ceiling.
const REQUEST_INTERVAL_MS = 150;

// Exact set-cover search can get expensive for complicated decklists.
const SOLVER_TIME_LIMIT_MS = 3500;

const RARITIES = [
  { value: "common", label: "Common" },
  { value: "uncommon", label: "Uncommon" },
  { value: "rare", label: "Rare" },
  { value: "mythic", label: "Mythic" },
  { value: "special", label: "Special" },
  { value: "bonus", label: "Bonus" },
];

const state = {
  cards: [],
  setMeta: new Map(),

  // Uppercase set codes are used everywhere internally.
  disabledSets: new Set(),

  enabledRarities: new Set(
    RARITIES.map((rarity) => rarity.value)
  ),

  ignoreLands: false,
  checklistEnabled: false,

  // Checklist state intentionally lasts only for the current page/deck.
  checkedLocations: new Set(),

  analyzed: false,
};

let cache = loadCache();
let lastRequestAt = 0;
let activeRun = 0;

const $ = (id) => document.getElementById(id);

const decklistEl = $("decklist");
const analyzeBtn = $("analyzeBtn");
const statusEl = $("status");
const progressEl = $("progress");

const setPanel = $("setPanel");
const setListEl = $("setList");
const setFilterEl = $("setFilter");

const resultsPanel = $("resultsPanel");
const summaryEl = $("summary");
const resultsEl = $("results");

const missingPanel = $("missingPanel");
const missingEl = $("missing");

const unavailablePanel = $("unavailablePanel");
const unavailableEl = $("unavailable");

const ignoreLandsEl = $("ignoreLands");
const checklistToggleEl = $("checklistToggle");

loadSettings();
applyLoadedSettingsToControls();

analyzeBtn.addEventListener(
  "click",
  analyzeDeck
);

$("clearCache").addEventListener(
  "click",
  () => {
    cache = {};
    saveCache();

    setStatus(
      "Scryfall lookup cache cleared."
    );
  }
);

$("enableAll").addEventListener(
  "click",
  () => {
    state.disabledSets.clear();

    saveSettings();
    renderSetFilters();
    recomputeResults();
  }
);

$("disableAll").addEventListener(
  "click",
  () => {
    for (
      const code of state.setMeta.keys()
    ) {
      state.disabledSets.add(code);
    }

    saveSettings();
    renderSetFilters();
    recomputeResults();
  }
);

setFilterEl.addEventListener(
  "input",
  renderSetFilters
);

ignoreLandsEl.addEventListener(
  "change",
  () => {
    state.ignoreLands =
      ignoreLandsEl.checked;

    saveSettings();
    renderSetFilters();
    recomputeResults();
  }
);

checklistToggleEl.addEventListener(
  "change",
  () => {
    state.checklistEnabled =
      checklistToggleEl.checked;

    saveSettings();
    recomputeResults();
  }
);

document
  .querySelectorAll(".rarity-toggle")
  .forEach((checkbox) => {
    checkbox.addEventListener(
      "change",
      () => {
        const rarity =
          checkbox.dataset.rarity;

        if (checkbox.checked) {
          state.enabledRarities.add(
            rarity
          );
        } else {
          state.enabledRarities.delete(
            rarity
          );
        }

        saveSettings();
        renderSetFilters();
        recomputeResults();
      }
    );
  });

document
  .querySelectorAll('input[name="mode"]')
  .forEach((radio) => {
    radio.addEventListener(
      "change",
      recomputeResults
    );
  });

setListEl.addEventListener(
  "change",
  (event) => {
    const input =
      event.target.closest(
        "input[data-set-code]"
      );

    if (!input) {
      return;
    }

    const code =
      input.dataset.setCode.toUpperCase();

    if (input.checked) {
      state.disabledSets.delete(code);
    } else {
      state.disabledSets.add(code);
    }

    saveSettings();
    recomputeResults();
  }
);

/*
 * On touchscreen devices there is no hover,
 * so tapping a card toggles its preview.
 */
document.addEventListener(
  "click",
  (event) => {
    const chip =
      event.target.closest(".card-chip");

    document
      .querySelectorAll(
        ".card-chip.open"
      )
      .forEach((el) => {
        if (el !== chip) {
          el.classList.remove(
            "open"
          );
        }
      });

    if (
      chip &&
      window.matchMedia(
        "(hover: none)"
      ).matches
    ) {
      chip.classList.toggle("open");
    }
  }
);


/* ============================================================
   Filter controls
   ============================================================ */

function applyLoadedSettingsToControls() {
  ignoreLandsEl.checked =
    state.ignoreLands;

  checklistToggleEl.checked =
    state.checklistEnabled;

  document
    .querySelectorAll(
      ".rarity-toggle"
    )
    .forEach((checkbox) => {
      checkbox.checked =
        state.enabledRarities.has(
          checkbox.dataset.rarity
        );
    });
}


/* ============================================================
   Deck processing
   ============================================================ */

async function analyzeDeck() {
  const runId = ++activeRun;

  const cards =
    parseDecklist(
      decklistEl.value
    );

  if (cards.length === 0) {
    setStatus(
      "Enter at least one card in the decklist.",
      true
    );

    return;
  }

  analyzeBtn.disabled = true;

  progressEl.hidden = false;

  setPanel.hidden = true;
  resultsPanel.hidden = true;
  missingPanel.hidden = true;
  unavailablePanel.hidden = true;

  state.analyzed = false;
  state.cards = [];
  state.setMeta.clear();

  // A newly analyzed deck starts with a fresh collection checklist.
  state.checkedLocations.clear();

  resultsEl.innerHTML = "";
  unavailableEl.innerHTML = "";

  const resolved = [];
  const missing = [];

  try {
    for (
      let i = 0;
      i < cards.length;
      i++
    ) {
      if (runId !== activeRun) {
        return;
      }

      const entry = cards[i];

      setStatus(
        `Looking up ${i + 1} of ${cards.length}: ${entry.name}`
      );

      try {
        const lookup =
          await lookupCard(
            entry.name
          );

        resolved.push({
          key: entry.key,
          inputName: entry.name,
          name: lookup.name,
          count: entry.count,
          printings:
            lookup.printings,
          fuzzy: lookup.fuzzy,
        });
      } catch (error) {
        missing.push({
          ...entry,
          error: error.message,
        });
      }
    }

    if (resolved.length === 0) {
      throw new Error(
        "None of the decklist cards could be resolved by Scryfall."
      );
    }

    state.cards =
      resolved;

    buildSetMetadata();
    initializeUnknownSetsAsEnabled();

    state.analyzed = true;

    progressEl.hidden = true;
    setPanel.hidden = false;
    resultsPanel.hidden = false;
    missingPanel.hidden =
      missing.length === 0;

    renderMissing(missing);
    renderSetFilters();
    recomputeResults();

    const fuzzyCount =
      resolved.filter(
        (card) => card.fuzzy
      ).length;

    let suffix = "";

    if (fuzzyCount > 0) {
      suffix =
        ` ${fuzzyCount} card${
          fuzzyCount === 1
            ? " was"
            : "s were"
        } fuzzy-matched.`;
    }

    setStatus(
      `Resolved ${resolved.length} of ${cards.length} unique card${
        cards.length === 1
          ? ""
          : "s"
      }.${suffix}`
    );
  } catch (error) {
    progressEl.hidden = true;

    setStatus(
      error.message,
      true
    );
  } finally {
    analyzeBtn.disabled = false;
  }
}


/*
 * Supports common deck export forms:
 *
 *   4 Lightning Bolt
 *   4x Lightning Bolt
 *   Lightning Bolt x4
 *   1 Lightning Bolt (M11) 149
 *   1 Lightning Bolt [M11] 149
 */
function parseDecklist(text) {
  const map = new Map();

  for (
    const raw of text.split(
      /\r?\n/
    )
  ) {
    let line = raw.trim();

    if (!line) {
      continue;
    }

    if (
      /^(?:sideboard|commander|companion|mainboard|deck)\s*:?$/i.test(
        line
      )
    ) {
      continue;
    }

    if (
      /^(?:sideboard|commander|companion)\s*:/i.test(
        line
      )
    ) {
      continue;
    }

    if (/^[#/]/.test(line)) {
      continue;
    }

    line =
      line.replace(
        /^\*?\s*(?:sb|sideboard)\s*:\s*/i,
        ""
      );

    let count = 1;
    let name = line;

    let match =
      line.match(
        /^(\d+)\s*[x×]?\s+(.+)$/i
      );

    if (match) {
      count =
        Number.parseInt(
          match[1],
          10
        );

      name =
        match[2].trim();
    } else {
      match =
        line.match(
          /^(.+?)\s+[x×](\d+)$/i
        );

      if (match) {
        name =
          match[1].trim();

        count =
          Number.parseInt(
            match[2],
            10
          );
      }
    }

    // Remove common set/collector-number annotations.
    name =
      name
        .replace(
          /\s+\([A-Za-z0-9_-]{2,10}\)\s+\d+[A-Za-z]?\*?\s*$/i,
          ""
        )
        .replace(
          /\s+\[[A-Za-z0-9_-]{2,10}\]\s+\d+[A-Za-z]?\*?\s*$/i,
          ""
        )
        .trim();

    if (
      !name ||
      !Number.isFinite(count) ||
      count < 1
    ) {
      continue;
    }

    const key =
      normalizeName(name);

    const existing =
      map.get(key);

    if (existing) {
      existing.count +=
        count;
    } else {
      map.set(key, {
        key,
        name,
        count,
      });
    }
  }

  return [
    ...map.values(),
  ];
}


/* ============================================================
   Scryfall
   ============================================================ */

async function lookupCard(inputName) {
  const key =
    normalizeName(inputName);

  const cached =
    cache[key];

  /*
   * The cache format changed to v2 because typeLine is now required
   * for the land filter.
   */
  if (
    cached &&
    cached.value &&
    Array.isArray(
      cached.value.printings
    ) &&
    cached.value.printings.every(
      (printing) =>
        "typeLine" in printing
    ) &&
    Date.now() -
      cached.fetchedAt <
      CACHE_MAX_AGE_MS
  ) {
    return cached.value;
  }

  const query =
    `!"${inputName}"`;

  const searchUrl =
    `${API_BASE}/cards/search?` +
    new URLSearchParams({
      q: query,
      unique: "prints",
      order: "released",
    });

  let cards =
    await fetchAllSearchPages(
      searchUrl
    );

  let fuzzy = false;
  let resolvedName =
    inputName;

  /*
   * If the exact search failed, fall back to Scryfall's fuzzy
   * named endpoint, then retrieve all of that card's printings.
   */
  if (cards.length === 0) {
    const namedUrl =
      `${API_BASE}/cards/named?` +
      new URLSearchParams({
        fuzzy: inputName,
      });

    const named =
      await fetchJson(
        namedUrl
      );

    resolvedName =
      named.name;

    fuzzy = true;

    if (
      !named.prints_search_uri
    ) {
      cards = [named];
    } else {
      cards =
        await fetchAllSearchPages(
          named.prints_search_uri
        );
    }
  }

  /*
   * Only physical/paper cards are relevant for bulk storage.
   */
  const printings =
    cards
      .filter(
        (card) =>
          Array.isArray(
            card.games
          ) &&
          card.games.includes(
            "paper"
          )
      )
      .map(toPrinting)
      .filter(
        (printing) =>
          printing.setCode &&
          printing.setName
      );

  if (
    printings.length === 0
  ) {
    throw new Error(
      `Scryfall found no physical-paper printings for “${inputName}”.`
    );
  }

  const value = {
    name: resolvedName,
    printings,
    fuzzy,
  };

  cache[key] = {
    fetchedAt: Date.now(),
    value,
  };

  saveCache();

  return value;
}


async function fetchAllSearchPages(
  firstUrl
) {
  let url = firstUrl;

  const all = [];
  let safety = 0;

  while (
    url &&
    safety++ < 100
  ) {
    const data =
      await fetchJson(url);

    all.push(
      ...(data.data || [])
    );

    url =
      data.has_more
        ? data.next_page
        : null;
  }

  return all;
}


async function fetchJson(url) {
  await waitForRateLimit();

  let response =
    await fetch(url, {
      headers: {
        Accept:
          "application/json",
      },
    });

  if (
    response.status === 429
  ) {
    const retryAfter =
      Number.parseFloat(
        response.headers.get(
          "Retry-After"
        )
      ) || 2;

    await sleep(
      Math.max(
        1500,
        retryAfter * 1000
      )
    );

    await waitForRateLimit();

    response =
      await fetch(url, {
        headers: {
          Accept:
            "application/json",
        },
      });
  }

  if (!response.ok) {
    let detail = "";

    try {
      const body =
        await response.json();

      if (body.details) {
        detail =
          ` ${body.details}`;
      }
    } catch (_) {
      // Ignore malformed error bodies.
    }

    throw new Error(
      `Scryfall request failed (${response.status}).${detail}`
    );
  }

  return response.json();
}


async function waitForRateLimit() {
  const elapsed =
    performance.now() -
    lastRequestAt;

  if (
    elapsed <
    REQUEST_INTERVAL_MS
  ) {
    await sleep(
      REQUEST_INTERVAL_MS -
        elapsed
    );
  }

  lastRequestAt =
    performance.now();
}


function toPrinting(card) {
  return {
    // Capitalize set codes at the point they enter our data model.
    setCode:
      String(
        card.set || ""
      ).toUpperCase(),

    setName:
      card.set_name || "",

    rarity:
      card.rarity ||
      "special",

    typeLine:
      card.type_line ||
      "",

    releasedAt:
      card.released_at ||
      "9999-12-31",

    image:
      getImageUri(card),

    scryfallUri:
      card.scryfall_uri ||
      `https://scryfall.com/card/${String(
        card.set || ""
      ).toLowerCase()}/${card.collector_number}`,
  };
}


function getImageUri(card) {
  return (
    card.image_uris
      ?.normal ||
    card.card_faces?.[0]
      ?.image_uris?.normal ||
    null
  );
}


/* ============================================================
   Set metadata / filtering
   ============================================================ */

function buildSetMetadata() {
  state.setMeta.clear();

  for (
    const card of state.cards
  ) {
    for (
      const printing of card.printings
    ) {
      const code =
        printing.setCode.toUpperCase();

      if (
        !state.setMeta.has(
          code
        )
      ) {
        state.setMeta.set(
          code,
          {
            code,
            name:
              printing.setName,
            releasedAt:
              printing.releasedAt,
          }
        );
      }
    }
  }
}


function initializeUnknownSetsAsEnabled() {
  for (
    const code of [
      ...state.disabledSets,
    ]
  ) {
    if (
      !state.setMeta.has(code)
    ) {
      state.disabledSets.delete(
        code
      );
    }
  }

  saveSettings();
}


function isLandPrinting(
  printing
) {
  return /\bLand\b/i.test(
    printing.typeLine || ""
  );
}


/*
 * Tests filters other than the set itself.
 */
function passesNonSetFilters(
  printing
) {
  if (
    !state.enabledRarities.has(
      printing.rarity
    )
  ) {
    return false;
  }

  if (
    state.ignoreLands &&
    isLandPrinting(printing)
  ) {
    return false;
  }

  return true;
}


function isPrintingAllowed(
  printing
) {
  return (
    !state.disabledSets.has(
      printing.setCode.toUpperCase()
    ) &&
    passesNonSetFilters(
      printing
    )
  );
}


/* ============================================================
   Optimization
   ============================================================ */

function recomputeResults() {
  if (!state.analyzed) {
    return;
  }

  const mode =
    document.querySelector(
      'input[name="mode"]:checked'
    ).value;

  const analysis =
    solveForMode(mode);

  renderSummary(
    analysis,
    mode
  );

  renderResults(
    analysis,
    mode
  );

  renderUnavailable(
    analysis.unavailableIndexes
  );
}


/*
 * Determine which cards are still individually obtainable,
 * then solve the set-cover problem only for those cards.
 *
 * This is the key change that allows us to return a useful
 * partial solution when some cards have been filtered out entirely.
 */
function solveForMode(mode) {
  const candidates =
    new Map();

  const availableIndexes = [];
  const unavailableIndexes = [];

  for (
    let cardIndex = 0;
    cardIndex <
      state.cards.length;
    cardIndex++
  ) {
    const card =
      state.cards[
        cardIndex
      ];

    let hasAllowedPrinting =
      false;

    for (
      const printing of card.printings
    ) {
      if (
        !isPrintingAllowed(
          printing
        )
      ) {
        continue;
      }

      hasAllowedPrinting =
        true;

      const locationKey =
        mode === "sets"
          ? printing.setCode.toUpperCase()
          : `${printing.setCode.toUpperCase()}|${printing.rarity}`;

      if (
        !candidates.has(
          locationKey
        )
      ) {
        candidates.set(
          locationKey,
          {
            key: locationKey,

            setCode:
              printing.setCode.toUpperCase(),

            setName:
              printing.setName,

            rarity:
              mode === "sets"
                ? null
                : printing.rarity,

            releasedAt:
              printing.releasedAt,

            cardIndexes: [],
            mask: 0n,
          }
        );
      }

      candidates
        .get(locationKey)
        .cardIndexes.push(
          cardIndex
        );
    }

    if (
      hasAllowedPrinting
    ) {
      availableIndexes.push(
        cardIndex
      );
    } else {
      unavailableIndexes.push(
        cardIndex
      );
    }
  }

  /*
   * Create local bit positions for only the cards that can
   * currently be obtained.
   */
  const localIndexByCardIndex =
    new Map(
      availableIndexes.map(
        (
          cardIndex,
          localIndex
        ) => [
          cardIndex,
          localIndex,
        ]
      )
    );

  for (
    const candidate of
      candidates.values()
  ) {
    for (
      const cardIndex of
        candidate.cardIndexes
    ) {
      const localIndex =
        localIndexByCardIndex.get(
          cardIndex
        );

      candidate.mask |=
        1n <<
        BigInt(
          localIndex
        );
    }
  }

  const candidateList =
    dedupeAndReduceCandidates(
      [...candidates.values()]
    );

  const solution =
    solveSetCover(
      candidateList,
      availableIndexes.length
    );

  return {
    mode,
    candidates:
      candidateList,

    availableIndexes,
    unavailableIndexes,

    solution,
  };
}


/*
 * If two locations cover the exact same set of deck cards,
 * only one is necessary.
 *
 * Then remove dominated candidates:
 *
 *     A is a subset of B
 *
 * Since both locations cost one box to check, A is never
 * strictly better than B for this optimization.
 */
function dedupeAndReduceCandidates(
  candidates
) {
  const byMask = new Map();

  for (
    const candidate of candidates
  ) {
    if (
      candidate.mask === 0n
    ) {
      continue;
    }

    const key =
      candidate.mask.toString();

    const existing =
      byMask.get(key);

    if (
      !existing ||
      compareCandidates(
        candidate,
        existing
      ) < 0
    ) {
      byMask.set(
        key,
        candidate
      );
    }
  }

  const deduped =
    [...byMask.values()]
      .sort(
        (a, b) => {
          const diff =
            popcount(b.mask) -
            popcount(a.mask);

          return (
            diff ||
            compareCandidates(
              a,
              b
            )
          );
        }
      );

  const reduced = [];

  outer:
  for (
    let i = 0;
    i < deduped.length;
    i++
  ) {
    const candidate =
      deduped[i];

    for (
      let j = 0;
      j < i;
      j++
    ) {
      const larger =
        deduped[j];

      if (
        (candidate.mask |
          larger.mask) ===
        larger.mask
      ) {
        continue outer;
      }
    }

    reduced.push(
      candidate
    );
  }

  return reduced;
}


function compareCandidates(
  a,
  b
) {
  const date =
    a.releasedAt.localeCompare(
      b.releasedAt
    );

  if (date) {
    return date;
  }

  const name =
    a.setName.localeCompare(
      b.setName
    );

  if (name) {
    return name;
  }

  return a.key.localeCompare(
    b.key
  );
}


/*
 * Exact minimum set cover using branch-and-bound.
 *
 * BigInt bitmasks allow decks much larger than 32 cards.
 */
function solveSetCover(
  candidates,
  universeSize
) {
  if (
    universeSize === 0
  ) {
    return {
      selected: [],
      candidates,
      optimal: true,
      timeMs: 0,
    };
  }

  const fullMask =
    (1n <<
      BigInt(
        universeSize
      )) -
    1n;

  /*
   * For each card, track which candidates contain it.
   */
  const covering =
    Array.from(
      {
        length:
          universeSize,
      },
      () => []
    );

  for (
    let ci = 0;
    ci < candidates.length;
    ci++
  ) {
    let mask =
      candidates[ci].mask;

    while (mask) {
      const lsb =
        mask & -mask;

      const bitIndex =
        bigIntLog2(lsb);

      covering[
        bitIndex
      ].push(ci);

      mask ^= lsb;
    }
  }

  /*
   * This should not normally happen because solveForMode
   * already identifies unavailable cards, but keep the solver
   * defensive.
   */
  for (
    const options of covering
  ) {
    if (
      options.length === 0
    ) {
      return null;
    }
  }

  /*
   * Start with a greedy solution to establish an upper bound.
   */
  const greedy =
    greedyCover(
      candidates,
      fullMask
    );

  if (!greedy) {
    return null;
  }

  let best = greedy;
  let timedOut = false;

  const started =
    performance.now();

  function dfs(
    covered,
    chosen
  ) {
    if (
      performance.now() -
        started >
      SOLVER_TIME_LIMIT_MS
    ) {
      timedOut = true;
      return;
    }

    if (
      covered === fullMask
    ) {
      if (
        chosen.length <
        best.length
      ) {
        best = [
          ...chosen,
        ];
      }

      return;
    }

    if (
      chosen.length >=
      best.length
    ) {
      return;
    }

    const uncovered =
      fullMask ^
      (fullMask &
        covered);

    const uncoveredCount =
      popcount(
        uncovered
      );

    let targetOptions =
      null;

    let maxGain = 0;

    /*
     * Pick an uncovered card with the fewest ways of
     * satisfying it. This usually shrinks the search tree.
     */
    for (
      let cardIndex = 0;
      cardIndex <
        universeSize;
      cardIndex++
    ) {
      const bit =
        1n <<
        BigInt(
          cardIndex
        );

      if (
        (covered & bit) !==
        0n
      ) {
        continue;
      }

      const options = [];

      for (
        const ci of
          covering[
            cardIndex
          ]
      ) {
        const gainMask =
          candidates[ci]
            .mask &
          uncovered;

        if (
          gainMask !==
          0n
        ) {
          options.push(
            ci
          );
        }

        const gain =
          popcount(
            gainMask
          );

        if (
          gain > maxGain
        ) {
          maxGain =
            gain;
        }
      }

      if (
        options.length ===
        0
      ) {
        return;
      }

      if (
        targetOptions ===
          null ||
        options.length <
          targetOptions.length
      ) {
        targetOptions =
          options;
      }
    }

    if (
      !targetOptions ||
      maxGain === 0
    ) {
      return;
    }

    /*
     * Lower bound:
     *
     * If at most 5 cards can be gained per box and
     * 17 cards remain, at least ceil(17/5) = 4 more
     * boxes are necessary.
     */
    const lowerBound =
      Math.ceil(
        uncoveredCount /
          maxGain
      );

    if (
      chosen.length +
        lowerBound >=
      best.length
    ) {
      return;
    }

    targetOptions.sort(
      (a, b) => {
        const gainA =
          popcount(
            candidates[a]
              .mask &
              uncovered
          );

        const gainB =
          popcount(
            candidates[b]
              .mask &
              uncovered
          );

        return (
          gainB - gainA ||
          compareCandidates(
            candidates[a],
            candidates[b]
          )
        );
      }
    );

    for (
      const ci of
        targetOptions
    ) {
      dfs(
        covered |
          candidates[ci]
            .mask,

        [
          ...chosen,
          ci,
        ]
      );

      if (timedOut) {
        return;
      }
    }
  }

  dfs(
    0n,
    []
  );

  return {
    selected: best,
    candidates,
    optimal:
      !timedOut,
    timeMs:
      Math.round(
        performance.now() -
          started
      ),
  };
}


/*
 * Greedy upper-bound solution.
 */
function greedyCover(
  candidates,
  fullMask
) {
  let covered = 0n;
  const selected = [];

  while (
    covered !== fullMask
  ) {
    let bestIndex = -1;
    let bestGain = 0;

    for (
      let i = 0;
      i < candidates.length;
      i++
    ) {
      if (
        selected.includes(i)
      ) {
        continue;
      }

      const gain =
        popcount(
          candidates[i]
            .mask &
            (fullMask ^
              (fullMask &
                covered))
        );

      if (
        gain > bestGain
      ) {
        bestGain =
          gain;

        bestIndex =
          i;
      }
    }

    if (
      bestIndex < 0
    ) {
      return null;
    }

    selected.push(
      bestIndex
    );

    covered |=
      candidates[
        bestIndex
      ].mask;
  }

  return selected;
}


/* ============================================================
   Result rendering
   ============================================================ */

function renderSummary(
  analysis,
  mode
) {
  const solution =
    analysis.solution;

  const unavailableCount =
    analysis
      .unavailableIndexes
      .length;

  const totalCopies =
    state.cards.reduce(
      (sum, card) =>
        sum + card.count,
      0
    );

  /*
   * All cards may have become unavailable due to the active filters.
   */
  if (!solution) {
    summaryEl.innerHTML = `
      <div class="summary-stat">
        <strong>0 sets to check</strong>

        <span>
          ${unavailableCount} of ${state.cards.length}
          unique cards are unavailable with the current filters.
        </span>
      </div>

      <div class="solver-note">
        No searchable card has an enabled printing.
      </div>
    `;

    return;
  }

  const setCount =
    new Set(
      solution.selected.map(
        (i) =>
          solution
            .candidates[i]
            .setCode
      )
    ).size;

  const locations =
    solution.selected.length;

  const availableCopies =
    analysis.availableIndexes.reduce(
      (sum, cardIndex) =>
        sum +
        state.cards[
          cardIndex
        ].count,
      0
    );

  const primary =
    mode === "sets"
      ? `${locations} set${
          locations === 1
            ? ""
            : "s"
        } to check`
      : `${locations} rarity box${
          locations === 1
            ? ""
            : "es"
        } across ${setCount} set${
          setCount === 1
            ? ""
            : "s"
        }`;

  let proof;

  if (
    solution.optimal
  ) {
    proof =
      `Minimum proven by the exact solver (${solution.timeMs} ms).`;
  } else {
    proof =
      `Best solution found within the ${
        SOLVER_TIME_LIMIT_MS / 1000
      }-second solver limit; minimum not proven.`;
  }

  if (
    unavailableCount > 0
  ) {
    proof +=
      ` ${unavailableCount} unique card${
        unavailableCount === 1
          ? " is"
          : "s are"
      } unavailable under the current filters.`;
  }

  summaryEl.innerHTML = `
    <div class="summary-stat">
      <strong>${primary}</strong>

      <span>
        ${analysis.availableIndexes.length}
        searchable unique card${
          analysis.availableIndexes.length === 1
            ? ""
            : "s"
        }
        ·
        ${availableCopies}
        searchable copies
        ·
        ${totalCopies}
        total deck copies
      </span>
    </div>

    <div class="solver-note">
      ${escapeHtml(proof)}
    </div>
  `;
}


function renderResults(
  analysis,
  mode
) {
  const solution =
    analysis.solution;

  resultsEl.innerHTML = "";

  if (!solution) {
    resultsEl.innerHTML = `
      <div class="empty-state">
        No cards remain searchable with the current filters.
        The excluded cards are listed below.
      </div>
    `;

    return;
  }

  const selected =
    solution.selected.map(
      (index) =>
        solution
          .candidates[index]
    );

  /*
   * Every searchable card is assigned to one selected location
   * for the purposes of the displayed shopping/collection list.
   */
  const assignment =
    new Map();

  for (
    const cardIndex of
      analysis.availableIndexes
  ) {
    const location =
      selected.find(
        (candidate) =>
          candidate.cardIndexes.includes(
            cardIndex
          )
      );

    if (location) {
      assignment.set(
        cardIndex,
        location.key
      );
    }
  }

  const groups =
    new Map();

  for (
    const location of selected
  ) {
    groups.set(
      location.key,
      {
        location,
        cardIndexes: [],
      }
    );
  }

  for (
    const [
      cardIndex,
      locationKey,
    ] of assignment.entries()
  ) {
    groups
      .get(locationKey)
      ?.cardIndexes.push(
        cardIndex
      );
  }

  const groupList =
    [...groups.values()];

  if (
    mode === "sets"
  ) {
    groupList.sort(
      (a, b) =>
        compareCandidates(
          a.location,
          b.location
        )
    );
  } else {
    groupList.sort(
      (a, b) => {
        const rarity =
          rarityRank(
            a.location.rarity
          ) -
          rarityRank(
            b.location.rarity
          );

        return (
          rarity ||
          compareCandidates(
            a.location,
            b.location
          )
        );
      }
    );
  }

  for (
    const group of groupList
  ) {
    const {
      location,
      cardIndexes,
    } = group;

    const section =
      document.createElement(
        "section"
      );

    const checked =
      state.checkedLocations.has(
        location.key
      );

    section.className =
      `result-set${
        checked
          ? " collected"
          : ""
      }`;

    const heading =
      document.createElement(
        "div"
      );

    heading.className =
      "result-heading";

    const title =
      document.createElement(
        "div"
      );

    title.innerHTML = `
      <h3>
        ${escapeHtml(
          location.setName
        )}

        <code>
          ${escapeHtml(
            location.setCode.toUpperCase()
          )}
        </code>
      </h3>

      ${
        mode === "sets"
          ? ""
          : `
            <span class="rarity-label">
              ${prettyRarity(
                location.rarity
              )}
            </span>
          `
      }
    `;

    const right =
      document.createElement(
        "div"
      );

    right.className =
      "result-meta";

    if (
      state.checklistEnabled
    ) {
      const checklistLabel =
        document.createElement(
          "label"
        );

      checklistLabel.className =
        "checklist-control";

      const checkbox =
        document.createElement(
          "input"
        );

      checkbox.type =
        "checkbox";

      checkbox.checked =
        checked;

      checkbox.setAttribute(
        "aria-label",
        `Mark ${location.setName} as collected`
      );

      checkbox.addEventListener(
        "change",
        () => {
          if (
            checkbox.checked
          ) {
            state.checkedLocations.add(
              location.key
            );
          } else {
            state.checkedLocations.delete(
              location.key
            );
          }

          renderResults(
            analysis,
            mode
          );
        }
      );

      const labelText =
        document.createElement(
          "span"
        );

      labelText.textContent =
        checked
          ? "Collected"
          : "Check off";

      checklistLabel.append(
        checkbox,
        labelText
      );

      right.appendChild(
        checklistLabel
      );
    }

    const count =
      document.createElement(
        "span"
      );

    count.textContent =
      `${cardIndexes.length} unique card${
        cardIndexes.length === 1
          ? ""
          : "s"
      }`;

    right.appendChild(
      count
    );

    heading.append(
      title,
      right
    );

    const list =
      document.createElement(
        "div"
      );

    list.className =
      "card-list";

    cardIndexes.sort(
      (a, b) =>
        state.cards[a]
          .name.localeCompare(
            state.cards[b]
              .name
          )
    );

    for (
      const cardIndex of
        cardIndexes
    ) {
      list.appendChild(
        createCardChip(
          state.cards[
            cardIndex
          ]
        )
      );
    }

    section.append(
      heading,
      list
    );

    resultsEl.appendChild(
      section
    );
  }
}


function renderUnavailable(
  unavailableIndexes
) {
  unavailablePanel.hidden =
    unavailableIndexes.length ===
    0;

  unavailableEl.innerHTML =
    "";

  if (
    unavailableIndexes.length ===
    0
  ) {
    return;
  }

  for (
    const cardIndex of
      unavailableIndexes
  ) {
    const card =
      state.cards[
        cardIndex
      ];

    const row =
      document.createElement(
        "div"
      );

    row.className =
      "unavailable-card-row";

    row.appendChild(
      createCardChip(
        card,
        "unavailable-chip"
      )
    );

    const reason =
      document.createElement(
        "span"
      );

    reason.textContent =
      getUnavailableReason(
        card
      );

    row.appendChild(
      reason
    );

    unavailableEl.appendChild(
      row
    );
  }
}


/*
 * Explain the most useful reason for a card becoming unavailable.
 */
function getUnavailableReason(
  card
) {
  const hasSetMatch =
    card.printings.some(
      (printing) =>
        passesNonSetFilters(
          printing
        )
    );

  if (!hasSetMatch) {
    if (
      state.ignoreLands &&
      card.printings.every(
        (printing) =>
          isLandPrinting(
            printing
          )
      )
    ) {
      return "Excluded because lands are being ignored.";
    }

    if (
      state.enabledRarities.size ===
      0
    ) {
      return "Excluded because every rarity is toggled off.";
    }

    return "No printing matches the enabled rarity and land filters.";
  }

  return "All matching printings are in sets that are currently disabled.";
}


/*
 * Create a hoverable card chip.
 *
 * The tooltip shows every paper set for that card, not only
 * sets that are currently enabled.
 */
function createCardChip(
  card,
  extraClass = ""
) {
  const button =
    document.createElement(
      "button"
    );

  button.type =
    "button";

  button.className =
    `card-chip ${extraClass}`.trim();

  button.title =
    "Hover or focus for all paper printings";

  const label =
    document.createElement(
      "span"
    );

  label.className =
    "card-label";

  label.textContent =
    `${card.count}× ${card.name}`;

  const tooltip =
    document.createElement(
      "span"
    );

  tooltip.className =
    "card-tooltip";

  const image =
    getBestImage(
      card.printings
    );

  if (image) {
    const img =
      document.createElement(
        "img"
      );

    img.src = image;
    img.alt =
      `${card.name} card image`;

    img.loading =
      "lazy";

    tooltip.appendChild(
      img
    );
  }

  const details =
    document.createElement(
      "span"
    );

  details.className =
    "tooltip-details";

  const title =
    document.createElement(
      "strong"
    );

  title.textContent =
    card.fuzzy
      ? `${card.name} (matched from “${card.inputName}”)`
      : card.name;

  details.appendChild(
    title
  );

  const subtitle =
    document.createElement(
      "span"
    );

  subtitle.className =
    "tooltip-subtitle";

  subtitle.textContent =
    "Paper sets:";

  details.appendChild(
    subtitle
  );

  const setsList =
    document.createElement(
      "span"
    );

  setsList.className =
    "tooltip-sets";

  /*
   * Show each set once, combining the rarities in which the
   * card appears in that set.
   */
  const setRows =
    new Map();

  const sortedPrintings =
    [...card.printings].sort(
      (a, b) =>
        a.releasedAt.localeCompare(
          b.releasedAt
        ) ||
        a.setName.localeCompare(
          b.setName
        ) ||
        a.rarity.localeCompare(
          b.rarity
        )
    );

  for (
    const printing of
      sortedPrintings
  ) {
    const code =
      printing.setCode.toUpperCase();

    if (
      !setRows.has(code)
    ) {
      setRows.set(
        code,
        {
          setName:
            printing.setName,

          code,

          rarities:
            new Set(),

          anyAllowed:
            false,
        }
      );
    }

    const row =
      setRows.get(code);

    row.rarities.add(
      printing.rarity
    );

    if (
      isPrintingAllowed(
        printing
      )
    ) {
      row.anyAllowed =
        true;
    }
  }

  for (
    const rowData of
      setRows.values()
  ) {
    const row =
      document.createElement(
        "span"
      );

    row.className =
      rowData.anyAllowed
        ? ""
        : "ignored";

    const rarityText =
      [
        ...rowData.rarities,
      ]
        .sort(
          (a, b) =>
            rarityRank(a) -
              rarityRank(b) ||
            a.localeCompare(b)
        )
        .map(prettyRarity)
        .join(", ");

    const suffix =
      rowData.anyAllowed
        ? ""
        : " — ignored";

    row.textContent =
      `${rowData.setName} (${rowData.code}) · ${rarityText}${suffix}`;

    setsList.appendChild(
      row
    );
  }

  details.appendChild(
    setsList
  );

  tooltip.appendChild(
    details
  );

  button.append(
    label,
    tooltip
  );

  return button;
}


function getBestImage(
  printings
) {
  return (
    printings.find(
      (printing) =>
        printing.image
    )?.image || null
  );
}


/* ============================================================
   Set filter UI
   ============================================================ */

function renderSetFilters() {
  const filter =
    normalizeName(
      setFilterEl.value
    );

  setListEl.innerHTML =
    "";

  const entries =
    [...state.setMeta.values()]
      .filter(
        (set) => {
          if (!filter) {
            return true;
          }

          return (
            normalizeName(
              set.name
            ).includes(
              filter
            ) ||
            set.code
              .toLowerCase()
              .includes(
                filter
              )
          );
        }
      )
      .sort(
        (a, b) =>
          a.name.localeCompare(
            b.name
          )
      );

  for (
    const set of entries
  ) {
    const label =
      document.createElement(
        "label"
      );

    label.className =
      "set-option";

    const checkbox =
      document.createElement(
        "input"
      );

    checkbox.type =
      "checkbox";

    checkbox.checked =
      !state.disabledSets.has(
        set.code
      );

    checkbox.dataset.setCode =
      set.code.toUpperCase();

    const coverage =
      countSetCoverage(
        set.code
      );

    const text =
      document.createElement(
        "span"
      );

    text.innerHTML = `
      <strong>
        ${escapeHtml(
          set.name
        )}
      </strong>

      <code>
        ${escapeHtml(
          set.code.toUpperCase()
        )}
      </code>

      <small>
        ${coverage} unique deck card${
          coverage === 1
            ? ""
            : "s"
        } after rarity/land filters
      </small>
    `;

    label.append(
      checkbox,
      text
    );

    setListEl.appendChild(
      label
    );
  }

  if (
    entries.length === 0
  ) {
    setListEl.innerHTML =
      `
        <div class="empty-state">
          No matching sets.
        </div>
      `;
  }
}


/*
 * Show how many cards a set could currently cover,
 * ignoring whether that particular set is itself disabled.
 *
 * This makes the number useful when deciding whether to re-enable it.
 */
function countSetCoverage(
  setCode
) {
  let count = 0;

  const normalizedCode =
    setCode.toUpperCase();

  for (
    const card of state.cards
  ) {
    if (
      card.printings.some(
        (printing) =>
          printing.setCode.toUpperCase() ===
            normalizedCode &&
          passesNonSetFilters(
            printing
          )
      )
    ) {
      count++;
    }
  }

  return count;
}


/* ============================================================
   Missing card UI
   ============================================================ */

function renderMissing(
  missing
) {
  missingEl.innerHTML =
    "";

  if (
    missing.length === 0
  ) {
    return;
  }

  for (
    const card of missing
  ) {
    const row =
      document.createElement(
        "div"
      );

    row.className =
      "missing-card";

    row.innerHTML = `
      <strong>
        ${escapeHtml(
          card.name
        )}
      </strong>

      <span>
        ${escapeHtml(
          card.error
        )}
      </span>
    `;

    missingEl.appendChild(
      row
    );
  }
}


/* ============================================================
   Utility functions
   ============================================================ */

function setStatus(
  message,
  isError = false
) {
  statusEl.textContent =
    message;

  statusEl.classList.toggle(
    "error",
    isError
  );
}


function normalizeName(
  name
) {
  return name
    .toLowerCase()
    .trim()
    .replace(
      /\s+/g,
      " "
    );
}


function prettyRarity(
  rarity
) {
  return (
    rarity.charAt(0)
      .toUpperCase() +
    rarity.slice(1)
  );
}


function rarityRank(
  rarity
) {
  const order = [
    "common",
    "uncommon",
    "rare",
    "mythic",
    "special",
    "bonus",
  ];

  const index =
    order.indexOf(
      rarity
    );

  return (
    index >= 0
      ? index + 1
      : 99
  );
}


function escapeHtml(
  value
) {
  return String(value)
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}


function popcount(
  value
) {
  let count = 0;

  while (value) {
    value &=
      value - 1n;

    count++;
  }

  return count;
}


function bigIntLog2(
  value
) {
  return (
    value.toString(
      2
    ).length - 1
  );
}


function sleep(
  ms
) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );
}


/* ============================================================
   localStorage
   ============================================================ */

function loadCache() {
  try {
    return JSON.parse(
      localStorage.getItem(
        CACHE_KEY
      ) || "{}"
    );
  } catch (_) {
    return {};
  }
}


function saveCache() {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify(
        cache
      )
    );
  } catch (_) {
    // Ignore unavailable/full localStorage.
  }
}


function loadSettings() {
  try {
    const value =
      JSON.parse(
        localStorage.getItem(
          SETTINGS_KEY
        ) || "{}"
      );

    state.disabledSets =
      new Set(
        (
          value.disabledSets ||
          []
        ).map(
          (code) =>
            String(
              code
            ).toUpperCase()
        )
      );

    const savedRarities =
      Array.isArray(
        value.enabledRarities
      )
        ? value
            .enabledRarities
            .map(
              (rarity) =>
                String(
                  rarity
                ).toLowerCase()
            )
            .filter(
              (rarity) =>
                RARITIES.some(
                  (entry) =>
                    entry.value ===
                    rarity
                )
            )
        : null;

    state.enabledRarities =
      new Set(
        savedRarities ??
          RARITIES.map(
            (rarity) =>
              rarity.value
          )
      );

    state.ignoreLands =
      Boolean(
        value.ignoreLands
      );

    state.checklistEnabled =
      Boolean(
        value.checklistEnabled
      );
  } catch (_) {
    state.disabledSets =
      new Set();

    state.enabledRarities =
      new Set(
        RARITIES.map(
          (rarity) =>
            rarity.value
        )
      );

    state.ignoreLands =
      false;

    state.checklistEnabled =
      false;
  }
}


function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        disabledSets: [
          ...state.disabledSets,
        ].map(
          (code) =>
            code.toUpperCase()
        ),

        enabledRarities: [
          ...state.enabledRarities,
        ],

        ignoreLands:
          state.ignoreLands,

        checklistEnabled:
          state.checklistEnabled,
      })
    );
  } catch (_) {
    // Ignore unavailable storage.
  }
}