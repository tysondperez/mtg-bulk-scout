const API_BASE = "https://api.scryfall.com";

const CACHE_KEY =
  "mtg-bulk-scout-card-cache-v3";

const SETTINGS_KEY =
  "mtg-bulk-scout-settings-v3";

const CACHE_MAX_AGE_MS =
  30 * 24 * 60 * 60 * 1000;

// Deliberately below Scryfall's stated request-rate ceiling.
const REQUEST_INTERVAL_MS = 150;

// Exact set-cover search can get expensive for complicated decklists.
const SOLVER_TIME_LIMIT_MS = 3500;

const RARITIES = [
  {
    value: "common",
    label: "Common",
  },
  {
    value: "uncommon",
    label: "Uncommon",
  },
  {
    value: "rare",
    label: "Rare",
  },
  {
    value: "mythic",
    label: "Mythic",
  },
  {
    value: "special",
    label: "Special",
  },
  {
    value: "bonus",
    label: "Bonus",
  },
];

/*
 * Set profile for the "Tyson" button.
 *
 * TSP / TSB are treated as two set codes because Scryfall
 * represents the Time Spiral main set and Timeshifted cards
 * separately.
 */
const TYSON_SETS = [
  ["Mercadian Masques", ["MMQ"]],
  ["Ravnica: City of Guilds", ["RAV"]],
  ["Guildpact", ["GPT"]],
  ["Dissension", ["DIS"]],
  ["Time Spiral", ["TSP", "TSB"]],
  ["Planar Chaos", ["PLC"]],
  ["Future Sight", ["FUT"]],
  ["Lorwyn", ["LRW"]],
  ["Morningtide", ["MOR"]],
  ["Shadowmoor", ["SHM"]],
  ["Eventide", ["EVE"]],
  ["Magic 2010", ["M10"]],
  ["Zendikar", ["ZEN"]],
  ["Worldwake", ["WWK"]],
  ["Rise of the Eldrazi", ["ROE"]],
  ["Magic 2011", ["M11"]],
  ["Scars of Mirrodin", ["SOM"]],
  ["Mirrodin Besieged", ["MBS"]],
  ["New Phyrexia", ["NPH"]],
  ["Magic 2012", ["M12"]],
  ["Innistrad", ["ISD"]],
  ["Dark Ascension", ["DKA"]],
  ["Avacyn Restored", ["AVR"]],
  ["Magic 2013", ["M13"]],
  ["Return to Ravnica", ["RTR"]],
  ["Gatecrash", ["GTC"]],
  ["Dragon's Maze", ["DGM"]],
  ["Modern Masters (2013)", ["MMA"]],
  ["Magic 2014", ["M14"]],
  ["Theros", ["THS"]],
  ["Born of the Gods", ["BNG"]],
  ["Journey into Nyx", ["JOU"]],
  ["Conspiracy", ["CNS"]],
  ["Magic 2015", ["M15"]],
  ["Khans of Tarkir", ["KTK"]],
  ["Fate Reforged", ["FRF"]],
  ["Dragons of Tarkir", ["DTK"]],
  ["Modern Masters 2015", ["MM2"]],
  ["Magic Origins", ["ORI"]],
  ["Battle for Zendikar", ["BFZ"]],
  ["Oath of the Gatewatch", ["OGW"]],
  ["Shadows over Innistrad", ["SOI"]],
  ["Eternal Masters", ["EMA"]],
  ["Eldritch Moon", ["EMN"]],
  ["Conspiracy: Take the Crown", ["CN2"]],
  ["Kaladesh", ["KLD"]],
  ["Aether Revolt", ["AER"]],
  ["Amonkhet", ["AKH"]],
  ["Hour of Devastation", ["HOU"]],
  ["Ixalan", ["XLN"]],
  ["Iconic Masters", ["IMA"]],
  ["Rivals of Ixalan", ["RIX"]],
  ["Dominaria", ["DOM"]],
  ["Battlebond", ["BBD"]],
  ["Core Set 2019", ["M19"]],
  ["Guilds of Ravnica", ["GRN"]],
  ["Ravnica Allegiance", ["RNA"]],
  ["War of the Spark", ["WAR"]],
  ["Modern Horizons", ["MH1"]],
  ["Core Set 2020", ["M20"]],
  ["Throne of Eldraine", ["ELD"]],
  ["Theros Beyond Death", ["THB"]],
  ["Ikoria: Lair of Behemoths", ["IKO"]],
  ["Core Set 2021", ["M21"]],
  ["Zendikar Rising", ["ZNR"]],
  ["Commander Legends", ["CMR"]],
  ["Kaldheim", ["KHM"]],
  ["Time Spiral Remastered", ["TSR"]],
  ["Strixhaven: School of Mages", ["STX"]],
  ["Modern Horizons 2", ["MH2"]],
  [
    "Dungeons & Dragons: Adventures in the Forgotten Realms",
    ["AFR"],
  ],
  ["Innistrad: Midnight Hunt", ["MID"]],
  ["Innistrad: Crimson Vow", ["VOW"]],
  ["Kamigawa: Neon Dynasty", ["NEO"]],
  ["Streets of New Capenna", ["SNC"]],
  ["Dominaria United", ["DMU"]],
  ["Unfinity", ["UNF"]],
  ["The Brothers' War", ["BRO"]],
  ["Dominaria Remastered", ["DMR"]],
  ["Phyrexia: All Will Be One", ["ONE"]],
  ["March of the Machine", ["MOM"]],
  [
    "The Lord of the Rings: Tales of Middle-Earth",
    ["LTR"],
  ],
  ["Wilds of Eldraine", ["WOE"]],
  ["The Lost Caverns of Ixalan", ["LCI"]],
  ["Ravnica Remastered", ["RVR"]],
  ["Murders at Karlov Manor", ["MKM"]],
  ["Outlaws of Thunder Junction", ["OTJ"]],
  ["Modern Horizons 3", ["MH3"]],
  ["Bloomburrow", ["BLB"]],
  ["Mystery Booster 2", ["MB2"]],
  ["Duskmorn: House of Horror", ["DSK"]],
  ["Foundations", ["FDN"]],
  ["Innistrad Remastered", ["INR"]],
  ["Aetherdrift", ["DFT"]],
  ["Tarkir: Dragonstorm", ["TDM"]],
  ["Final Fantasy", ["FIN"]],
  ["Edge of Eternities", ["EOE"]],
  ["Marvel's Spider-Man", ["SPM"]],
  ["Avatar: The Last Airbender", ["TLA"]],
  ["Secrets of Strixhaven", ["SOS"]],
  [
    "Secrets of Strixhaven Mystical Archives",
    ["SOA"],
  ],
  ["Strixhaven Mystical Archives", ["STA"]],
  ["Breaking News", ["OTP"]],
  ["The Hobbit", ["HOB"]],
  ["Reality Fracture", ["FRA"]],
];

const TYSON_CODES = new Set(
  TYSON_SETS.flatMap(
    ([, codes]) => codes
  ).map(
    (code) => code.toUpperCase()
  )
);

const state = {
  cards: [],
  setMeta: new Map(),

  // Set codes are always uppercase internally.
  disabledSets: new Set(),

  enabledRarities: new Set(
    RARITIES.map(
      (rarity) => rarity.value
    )
  ),

  ignoreLands: false,
  checklistEnabled: false,
  darkMode: false,

  sortMode: "default",

  // These are intentionally reset when a new deck is analyzed.
  checkedCards: new Set(),
  checkedLocations: new Set(),

  /*
   * card key -> Set of location keys.
   *
   * An absent entry means "use the optimizer's assignment".
   *
   * A card can have multiple manually selected locations.
   */
  manualPlacements: new Map(),

  analyzed: false,
};

let cache = loadCache();
let lastRequestAt = 0;
let activeRun = 0;

const $ = (id) =>
  document.getElementById(id);

const decklistEl =
  $("decklist");

const analyzeBtn =
  $("analyzeBtn");

const clearCacheBtn =
  $("clearCache");

const statusEl =
  $("status");

const progressEl =
  $("progress");

const setPanel =
  $("setPanel");

const setListEl =
  $("setList");

const setFilterEl =
  $("setFilter");

const resultsPanel =
  $("resultsPanel");

const summaryEl =
  $("summary");

const resultsEl =
  $("results");

const resultSortEl =
  $("resultSort");

const missingPanel =
  $("missingPanel");

const missingEl =
  $("missing");

const unavailablePanel =
  $("unavailablePanel");

const unavailableEl =
  $("unavailable");

const ignoreLandsEl =
  $("ignoreLands");

const checklistToggleEl =
  $("checklistToggle");

const darkModeToggleEl =
  $("darkModeToggle");


loadSettings();
applyLoadedSettingsToControls();
applyTheme();


/* ============================================================
   Event listeners
   ============================================================ */

analyzeBtn.addEventListener(
  "click",
  analyzeDeck
);

clearCacheBtn.addEventListener(
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
    state.disabledSets =
      new Set(
        state.setMeta.keys()
      );

    saveSettings();
    renderSetFilters();
    recomputeResults();
  }
);


$("tysonButton").addEventListener(
  "click",
  applyTysonFilter
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

    /*
     * Filter changes can invalidate previously chosen
     * manual locations. They are retained in state and
     * automatically ignored until valid again.
     */
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


darkModeToggleEl.addEventListener(
  "change",
  () => {
    state.darkMode =
      darkModeToggleEl.checked;

    saveSettings();
    applyTheme();
  }
);


resultSortEl.addEventListener(
  "change",
  () => {
    state.sortMode =
      resultSortEl.value;

    saveSettings();
    recomputeResults();
  }
);


document
  .querySelectorAll(".rarity-toggle")
  .forEach(
    (checkbox) => {
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
    }
  );


document
  .querySelectorAll(
    'input[name="mode"]'
  )
  .forEach(
    (radio) => {
      radio.addEventListener(
        "change",
        () => {
          /*
           * The location key format changes between modes,
           * so stale manual set/rariy choices are simply ignored
           * unless they happen to match the new mode.
           */
          recomputeResults();
        }
      );
    }
  );


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
      state.disabledSets.delete(
        code
      );
    } else {
      state.disabledSets.add(
        code
      );
    }

    saveSettings();
    recomputeResults();
  }
);


/* ============================================================
   Theme/settings controls
   ============================================================ */

function applyLoadedSettingsToControls() {
  ignoreLandsEl.checked =
    state.ignoreLands;

  checklistToggleEl.checked =
    state.checklistEnabled;

  darkModeToggleEl.checked =
    state.darkMode;

  resultSortEl.value =
    state.sortMode;

  document
    .querySelectorAll(
      ".rarity-toggle"
    )
    .forEach(
      (checkbox) => {
        checkbox.checked =
          state.enabledRarities.has(
            checkbox.dataset.rarity
          );
      }
    );
}


function applyTheme() {
  document.documentElement.dataset.theme =
    state.darkMode
      ? "dark"
      : "light";
}


/* ============================================================
   Deck processing
   ============================================================ */

async function analyzeDeck() {
  const runId =
    ++activeRun;

  const cards =
    parseDecklist(
      decklistEl.value
    );

  if (
    cards.length === 0
  ) {
    setStatus(
      "Enter at least one card in the decklist.",
      true
    );

    return;
  }

  analyzeBtn.disabled =
    true;

  progressEl.hidden =
    false;

  setPanel.hidden =
    true;

  resultsPanel.hidden =
    true;

  missingPanel.hidden =
    true;

  unavailablePanel.hidden =
    true;

  state.analyzed =
    false;

  state.cards =
    [];

  state.setMeta.clear();

  state.checkedCards.clear();
  state.checkedLocations.clear();
  state.manualPlacements.clear();

  resultsEl.innerHTML =
    "";

  unavailableEl.innerHTML =
    "";

  const resolved = [];
  const missing = [];

  try {
    for (
      let i = 0;
      i < cards.length;
      i++
    ) {
      if (
        runId !== activeRun
      ) {
        return;
      }

      const entry =
        cards[i];

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
          inputName:
            entry.name,
          name:
            lookup.name,
          count:
            entry.count,
          printings:
            lookup.printings,
          fuzzy:
            lookup.fuzzy,
        });
      } catch (error) {
        missing.push({
          ...entry,
          error:
            error.message,
        });
      }
    }

    if (
      resolved.length === 0
    ) {
      throw new Error(
        "None of the decklist cards could be resolved by Scryfall."
      );
    }

    state.cards =
      resolved;

    buildSetMetadata();
    initializeUnknownSetsAsEnabled();

    state.analyzed =
      true;

    progressEl.hidden =
      true;

    setPanel.hidden =
      false;

    resultsPanel.hidden =
      false;

    missingPanel.hidden =
      missing.length === 0;

    renderMissing(
      missing
    );

    renderSetFilters();
    recomputeResults();

    const fuzzyCount =
      resolved.filter(
        (card) =>
          card.fuzzy
      ).length;

    let suffix = "";

    if (
      fuzzyCount > 0
    ) {
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
    progressEl.hidden =
      true;

    setStatus(
      error.message,
      true
    );
  } finally {
    analyzeBtn.disabled =
      false;
  }
}


function parseDecklist(text) {
  const map =
    new Map();

  for (
    const raw of text.split(
      /\r?\n/
    )
  ) {
    let line =
      raw.trim();

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

    if (
      /^[#/]/.test(
        line
      )
    ) {
      continue;
    }

    line =
      line.replace(
        /^\*?\s*(?:sb|sideboard)\s*:\s*/i,
        ""
      );

    let count =
      1;

    let name =
      line;

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

    /*
     * Remove common deck-export set/collector-number annotations.
     */
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
      !Number.isFinite(
        count
      ) ||
      count < 1
    ) {
      continue;
    }

    const key =
      normalizeName(
        name
      );

    const existing =
      map.get(key);

    if (existing) {
      existing.count +=
        count;
    } else {
      map.set(
        key,
        {
          key,
          name,
          count,
        }
      );
    }
  }

  return [
    ...map.values(),
  ];
}


/* ============================================================
   Scryfall
   ============================================================ */

async function lookupCard(
  inputName
) {
  const key =
    normalizeName(
      inputName
    );

  const cached =
    cache[key];

  if (
    cached &&
    cached.value &&
    Array.isArray(
      cached.value.printings
    ) &&
    cached.value.printings.every(
      (printing) =>
        "typeLine" in
        printing
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

  let fuzzy =
    false;

  let resolvedName =
    inputName;

  if (
    cards.length === 0
  ) {
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

    fuzzy =
      true;

    if (
      !named.prints_search_uri
    ) {
      cards = [
        named,
      ];
    } else {
      cards =
        await fetchAllSearchPages(
          named.prints_search_uri
        );
    }
  }

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
      .map(
        toPrinting
      )
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
    name:
      resolvedName,

    printings,

    fuzzy,
  };

  cache[key] = {
    fetchedAt:
      Date.now(),

    value,
  };

  saveCache();

  return value;
}


async function fetchAllSearchPages(
  firstUrl
) {
  let url =
    firstUrl;

  const all = [];

  let safety =
    0;

  while (
    url &&
    safety++ < 100
  ) {
    const data =
      await fetchJson(
        url
      );

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


async function fetchJson(
  url
) {
  await waitForRateLimit();

  let response =
    await fetch(
      url,
      {
        headers: {
          Accept:
            "application/json",
        },
      }
    );

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
      await fetch(
        url,
        {
          headers: {
            Accept:
              "application/json",
          },
        }
      );
  }

  if (
    !response.ok
  ) {
    let detail =
      "";

    try {
      const body =
        await response.json();

      if (
        body.details
      ) {
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


function toPrinting(
  card
) {
  return {
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
      getImageUri(
        card
      ),
  };
}


function getImageUri(
  card
) {
  return (
    card.image_uris
      ?.normal ||
    card.card_faces?.[0]
      ?.image_uris?.normal ||
    null
  );
}


/* ============================================================
   Set metadata / filters
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
      !state.setMeta.has(
        code
      )
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
    isLandPrinting(
      printing
    )
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
   Tyson filter
   ============================================================ */

function applyTysonFilter() {
  /*
   * Only the sets currently relevant to the analyzed deck exist
   * in state.setMeta. Enable exactly the Tyson whitelist among them.
   */
  state.disabledSets =
    new Set(
      [...state.setMeta.keys()]
        .filter(
          (code) =>
            !TYSON_CODES.has(
              code.toUpperCase()
            )
        )
    );

  saveSettings();
  renderSetFilters();
  recomputeResults();

  setStatus(
    `Tyson set profile applied: ${
      [...state.setMeta.keys()]
        .filter(
          (code) =>
            TYSON_CODES.has(
              code
            )
        ).length
    } matching set${
      TYSON_CODES.size === 1
        ? ""
        : "s"
    } enabled.`
  );
}


/* ============================================================
   Optimization
   ============================================================ */

function recomputeResults() {
  if (
    !state.analyzed
  ) {
    return;
  }

  const mode =
    document.querySelector(
      'input[name="mode"]:checked'
    ).value;

  const analysis =
    solveForMode(
      mode
    );

  const displayData =
    buildDisplayData(
      analysis,
      mode
    );

  renderSummary(
    analysis,
    mode,
    displayData
  );

  renderResults(
    analysis,
    mode,
    displayData
  );

  renderUnavailable(
    analysis.unavailableIndexes
  );
}


/*
 * Determine which cards remain individually obtainable, then
 * solve the set-cover problem for only those cards.
 */
function solveForMode(
  mode
) {
  const allLocations =
    new Map();

  const availableIndexes =
    [];

  const unavailableIndexes =
    [];

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
      const printing of
        card.printings
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
        buildLocationKey(
          printing,
          mode
        );

      if (
        !allLocations.has(
          locationKey
        )
      ) {
        allLocations.set(
          locationKey,
          {
            key:
              locationKey,

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

            cardIndexes:
              new Set(),

            mask:
              0n,
          }
        );
      }

      allLocations
        .get(locationKey)
        .cardIndexes.add(
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
   * Convert the location card sets to arrays.
   */
  for (
    const location of
      allLocations.values()
  ) {
    location.cardIndexes =
      [
        ...location.cardIndexes,
      ];
  }

  /*
   * Give each currently obtainable card a local bit index.
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
    const location of
      allLocations.values()
  ) {
    let mask =
      0n;

    for (
      const cardIndex of
        location.cardIndexes
    ) {
      const localIndex =
        localIndexByCardIndex.get(
          cardIndex
        );

      if (
        localIndex !==
        undefined
      ) {
        mask |=
          1n <<
          BigInt(
            localIndex
          );
      }
    }

    location.mask =
      mask;
  }

  const candidateList =
    dedupeAndReduceCandidates(
      [...allLocations.values()]
    );

  const solution =
    solveSetCover(
      candidateList,
      availableIndexes.length
    );

  return {
    mode,

    /*
     * locationCatalog contains every currently legal storage
     * location, including locations eliminated by the optimizer.
     *
     * This is what makes post-solve manual placement possible.
     */
    locationCatalog:
      allLocations,

    candidates:
      candidateList,

    availableIndexes,

    unavailableIndexes,

    solution,
  };
}


function buildLocationKey(
  printing,
  mode
) {
  const code =
    printing.setCode
      .toUpperCase();

  if (
    mode === "sets"
  ) {
    return code;
  }

  return `${code}|${printing.rarity}`;
}


/*
 * Return all currently legal storage locations for one card.
 *
 * This intentionally uses locationCatalog rather than the reduced
 * solver candidates, so the user can select a suboptimal set too.
 */
function getAllowedLocationsForCard(
  cardIndex,
  analysis
) {
  const locations = [];

  for (
    const location of
      analysis.locationCatalog.values()
  ) {
    if (
      location.cardIndexes.includes(
        cardIndex
      )
    ) {
      locations.push(
        location
      );
    }
  }

  return locations;
}


/*
 * Remove stale manual locations and return the currently valid
 * manually selected locations for a card.
 */
function getCurrentManualPlacements(
  card,
  cardIndex,
  analysis
) {
  const selected =
    state.manualPlacements.get(
      card.key
    );

  if (
    !selected ||
    selected.size === 0
  ) {
    return [];
  }

  const active =
    [...selected].filter(
      (locationKey) => {
        const location =
          analysis.locationCatalog.get(
            locationKey
          );

        return (
          location &&
          location.cardIndexes.includes(
            cardIndex
          )
        );
      }
    );

  return active;
}


/*
 * If two locations cover exactly the same deck cards, only one
 * is necessary.
 *
 * Then remove dominated locations:
 *
 *     A is a subset of B
 *
 * Since both cost one physical location to inspect, A is never
 * preferable for this optimization.
 */
function dedupeAndReduceCandidates(
  candidates
) {
  const byMask =
    new Map();

  for (
    const candidate of
      candidates
  ) {
    if (
      candidate.mask === 0n
    ) {
      continue;
    }

    const key =
      candidate.mask.toString();

    const existing =
      byMask.get(
        key
      );

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
            popcount(
              b.mask
            ) -
            popcount(
              a.mask
            );

          return (
            diff ||
            compareCandidates(
              a,
              b
            )
          );
        }
      );

  const reduced =
    [];

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
      candidates[
        ci
      ].mask;

    while (mask) {
      const lsb =
        mask &
        -mask;

      const bitIndex =
        bigIntLog2(
          lsb
        );

      covering[
        bitIndex
      ].push(ci);

      mask ^=
        lsb;
    }
  }

  for (
    const options of
      covering
  ) {
    if (
      options.length === 0
    ) {
      return null;
    }
  }

  const greedy =
    greedyCover(
      candidates,
      fullMask
    );

  if (!greedy) {
    return null;
  }

  let best =
    greedy;

  let timedOut =
    false;

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
      timedOut =
        true;

      return;
    }

    if (
      covered ===
      fullMask
    ) {
      if (
        chosen.length <
        best.length
      ) {
        best =
          [
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

    let maxGain =
      0;

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

      const options =
        [];

      for (
        const ci of
          covering[
            cardIndex
          ]
      ) {
        const gainMask =
          candidates[
            ci
          ].mask &
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
          gain >
          maxGain
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
            candidates[
              a
            ].mask &
              uncovered
          );

        const gainB =
          popcount(
            candidates[
              b
            ].mask &
              uncovered
          );

        return (
          gainB -
            gainA ||
          compareCandidates(
            candidates[
              a
            ],
            candidates[
              b
            ]
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
          candidates[
            ci
          ].mask,

        [
          ...chosen,
          ci,
        ]
      );

      if (
        timedOut
      ) {
        return;
      }
    }
  }

  dfs(
    0n,
    []
  );

  return {
    selected:
      best,

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


function greedyCover(
  candidates,
  fullMask
) {
  let covered =
    0n;

  const selected =
    [];

  while (
    covered !==
    fullMask
  ) {
    let bestIndex =
      -1;

    let bestGain =
      0;

    for (
      let i = 0;
      i < candidates.length;
      i++
    ) {
      if (
        selected.includes(
          i
        )
      ) {
        continue;
      }

      const gain =
        popcount(
          candidates[
            i
          ].mask &
          (fullMask ^
            (fullMask &
              covered))
        );

      if (
        gain >
        bestGain
      ) {
        bestGain =
          gain;

        bestIndex =
          i;
      }
    }

    if (
      bestIndex <
      0
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
   Manual display assignment
   ============================================================ */

/*
 * Determine where each currently available card should be displayed.
 *
 * By default, use one location from the optimized solution.
 *
 * If the user manually selected one or more locations for the card,
 * those locations completely replace the automatic assignment.
 */
function buildDisplayData(
  analysis,
  mode
) {
  const solution =
    analysis.solution;

  if (!solution) {
    return {
      groups: [],
      solutionKeys:
        new Set(),
      displayedLocationsByCard:
        new Map(),
      manualExtraLocationKeys:
        new Set(),
    };
  }

  const solutionLocations =
    solution.selected.map(
      (index) =>
        solution.candidates[
          index
        ]
    );

  const solutionKeys =
    new Set(
      solutionLocations.map(
        (location) =>
          location.key
      )
    );

  const groupMap =
    new Map();

  /*
   * Start with every optimized solution location so that a
   * manually moved card does not make the optimized box vanish.
   */
  for (
    const location of
      solutionLocations
  ) {
    groupMap.set(
      location.key,
      {
        location,
        cardIndexes:
          new Set(),
      }
    );
  }

  const displayedLocationsByCard =
    new Map();

  for (
    const cardIndex of
      analysis.availableIndexes
  ) {
    const card =
      state.cards[
        cardIndex
      ];

    let locationKeys =
      getCurrentManualPlacements(
        card,
        cardIndex,
        analysis
      );

    /*
     * If no active manual placement exists, use the automatic
     * assignment from the optimized solution.
     */
    if (
      locationKeys.length ===
      0
    ) {
      const automatic =
        solutionLocations.find(
          (location) =>
            location.cardIndexes.includes(
              cardIndex
            )
        );

      if (
        automatic
      ) {
        locationKeys = [
          automatic.key,
        ];
      }
    }

    const validLocationKeys =
      [
        ...new Set(
          locationKeys.filter(
            (locationKey) =>
              analysis.locationCatalog.has(
                locationKey
              )
          )
        ),
      ];

    displayedLocationsByCard.set(
      cardIndex,
      validLocationKeys
    );

    for (
      const locationKey of
        validLocationKeys
    ) {
      const location =
        analysis.locationCatalog.get(
          locationKey
        );

      if (
        !location
      ) {
        continue;
      }

      if (
        !groupMap.has(
          locationKey
        )
      ) {
        groupMap.set(
          locationKey,
          {
            location,
            cardIndexes:
              new Set(),
          }
        );
      }

      groupMap
        .get(locationKey)
        .cardIndexes.add(
          cardIndex
        );
    }
  }

  const manualExtraLocationKeys =
    new Set(
      [...groupMap.keys()]
        .filter(
          (key) =>
            !solutionKeys.has(
              key
            )
        )
    );

  /*
   * Convert sets to arrays for rendering.
   */
  const groups =
    [...groupMap.values()]
      .map(
        (group) => ({
          location:
            group.location,

          cardIndexes:
            [
              ...group.cardIndexes,
            ],
        })
      );

  sortGroups(
    groups,
    state.sortMode
  );

  syncCheckedLocations(
    groups
  );

  return {
    groups,

    solutionKeys,

    displayedLocationsByCard,

    manualExtraLocationKeys,
  };
}


function sortGroups(
  groups,
  sortMode
) {
  groups.sort(
    (a, b) => {
      if (
        sortMode ===
        "alphabetical"
      ) {
        const nameCompare =
          a.location.setName.localeCompare(
            b.location.setName
          );

        if (
          nameCompare
        ) {
          return nameCompare;
        }

        const rarityCompare =
          rarityRank(
            a.location.rarity
          ) -
          rarityRank(
            b.location.rarity
          );

        if (
          rarityCompare
        ) {
          return rarityCompare;
        }

        return a.location.key.localeCompare(
          b.location.key
        );
      }

      if (
        sortMode ===
        "coverage"
      ) {
        const coverageDifference =
          b.location.cardIndexes.length -
          a.location.cardIndexes.length;

        if (
          coverageDifference
        ) {
          return coverageDifference;
        }

        return compareCandidates(
          a.location,
          b.location
        );
      }

      return compareCandidates(
        a.location,
        b.location
      );
    }
  );
}


/*
 * The card-level checklist is authoritative.
 * A location is considered checked when every card currently
 * displayed under that location is checked.
 */
function syncCheckedLocations(
  groups
) {
  const activeKeys =
    new Set();

  for (
    const group of groups
  ) {
    const cardIndexes =
      group.cardIndexes;

    if (
      cardIndexes.length ===
      0
    ) {
      continue;
    }

    const allChecked =
      cardIndexes.every(
        (cardIndex) =>
          state.checkedCards.has(
            state.cards[
              cardIndex
            ].key
          )
      );

    if (
      allChecked
    ) {
      activeKeys.add(
        group.location.key
      );
    }
  }

  state.checkedLocations =
    activeKeys;
}


function updateManualPlacements(
  card,
  cardIndex,
  selectedKeys,
  automaticKey
) {
  const normalized =
    [
      ...new Set(
        selectedKeys
      ),
    ].filter(
      (key) =>
        key
    );

  /*
   * Zero selections means "use the optimized placement".
   */
  if (
    normalized.length ===
    0
  ) {
    state.manualPlacements.delete(
      card.key
    );

    return;
  }

  /*
   * Selecting only the optimizer's automatic location is also
   * equivalent to having no manual override.
   */
  if (
    normalized.length ===
      1 &&
    normalized[0] ===
      automaticKey
  ) {
    state.manualPlacements.delete(
      card.key
    );

    return;
  }

  state.manualPlacements.set(
    card.key,
    new Set(
      normalized
    )
  );
}


/* ============================================================
   Result summary
   ============================================================ */

function renderSummary(
  analysis,
  mode,
  displayData
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
        (index) =>
          solution
            .candidates[
              index
            ]
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
        } in optimized solution`
      : `${locations} rarity box${
          locations === 1
            ? ""
            : "es"
        } in optimized solution`;

  let proof =
    solution.optimal
      ? `Minimum proven by the exact solver (${solution.timeMs} ms).`
      : `Best solution found within the ${
          SOLVER_TIME_LIMIT_MS /
          1000
        }-second solver limit; minimum not proven.`;

  if (
    displayData
      .manualExtraLocationKeys
      .size >
    0
  ) {
    const extraCount =
      displayData
        .manualExtraLocationKeys
        .size;

    proof +=
      ` ${extraCount} manually selected location${
        extraCount === 1
          ? " is"
          : "s are"
      } also displayed.`;
  }

  if (
    unavailableCount >
    0
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
      <strong>${escapeHtml(primary)}</strong>

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


/* ============================================================
   Result rendering
   ============================================================ */

function renderResults(
  analysis,
  mode,
  displayData
) {
  resultsEl.innerHTML =
    "";

  const solution =
    analysis.solution;

  if (
    !solution
  ) {
    resultsEl.innerHTML = `
      <div class="empty-state">
        No cards remain searchable with the current filters.
        The excluded cards are listed below.
      </div>
    `;

    return;
  }

  for (
    const group of
      displayData.groups
  ) {
    const section =
      document.createElement(
        "section"
      );

    const checked =
      state.checkedLocations.has(
        group.location.key
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

    const isManualExtra =
      !displayData.solutionKeys.has(
        group.location.key
      );

    title.innerHTML = `
      <h3>
        ${escapeHtml(
          group.location.setName
        )}

        <code>
          ${escapeHtml(
            group.location.setCode.toUpperCase()
          )}
        </code>

        ${
          isManualExtra
            ? `
              <span class="manual-badge">
                Manually added
              </span>
            `
            : ""
        }
      </h3>

      ${
        mode === "sets"
          ? ""
          : `
            <span class="rarity-label">
              ${prettyRarity(
                group.location.rarity
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

      checkbox.disabled =
        group.cardIndexes.length ===
        0;

      checkbox.setAttribute(
        "aria-label",
        `Mark ${group.location.setName} as collected`
      );

      checkbox.addEventListener(
        "change",
        () => {
          if (
            checkbox.checked
          ) {
            for (
              const cardIndex of
                group.cardIndexes
            ) {
              state.checkedCards.add(
                state.cards[
                  cardIndex
                ].key
              );
            }
          } else {
            for (
              const cardIndex of
                group.cardIndexes
            ) {
              state.checkedCards.delete(
                state.cards[
                  cardIndex
                ].key
              );
            }
          }

          recomputeResults();
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

    count.className =
      "result-count";

    const displayedCount =
      group.cardIndexes.length;

    const availableCount =
      group.location.cardIndexes.length;

    if (
      displayedCount ===
      availableCount
    ) {
      count.textContent =
        `${displayedCount} unique card${
          displayedCount === 1
            ? ""
            : "s"
        }`;
    } else {
      count.textContent =
        `${displayedCount} displayed · ${availableCount} available`;
    }

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

    group.cardIndexes.sort(
      (a, b) =>
        state.cards[
          a
        ].name.localeCompare(
          state.cards[
            b
          ].name
        )
    );

    const displayedLocationCountByCard =
      displayData.displayedLocationsByCard;

    for (
      const cardIndex of
        group.cardIndexes
    ) {
      const card =
        state.cards[
          cardIndex
        ];

      const displayedLocations =
        displayedLocationCountByCard.get(
          cardIndex
        ) || [];

      list.appendChild(
        createCardChip(
          card,
          {
            cardIndex,
            analysis,
            mode,
            displayedLocationCount:
              displayedLocations.length,
            unavailable:
              false,
          }
        )
      );
    }

    if (
      group.cardIndexes.length ===
      0
    ) {
      list.innerHTML = `
        <div class="empty-state">
          All cards from this storage location have
          been manually assigned elsewhere.
        </div>
      `;
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


/*
 * Creates one card display.
 *
 * The card image, complete set list, and placement controls
 * live in the hover/focus popup.
 */
function createCardChip(
  card,
  {
    cardIndex = null,
    analysis = null,
    mode = "sets",
    displayedLocationCount = 0,
    unavailable = false,
  } = {}
) {
  const wrapper =
    document.createElement(
      "div"
    );

  const duplicate =
    displayedLocationCount >
    1;

  wrapper.className =
    [
      "card-chip",
      duplicate
        ? "duplicate-card"
        : "",
      unavailable
        ? "unavailable-chip"
        : "",
    ]
      .filter(Boolean)
      .join(" ");

  /*
   * In checklist mode, the checkbox is independent from
   * the card-name button so HTML interactive elements are
   * not nested inside one another.
   */
  if (
    state.checklistEnabled &&
    !unavailable
  ) {
    const checkLabel =
      document.createElement(
        "label"
      );

    checkLabel.className =
      "card-check";

    const checkbox =
      document.createElement(
        "input"
      );

    checkbox.type =
      "checkbox";

    checkbox.checked =
      state.checkedCards.has(
        card.key
      );

    checkbox.setAttribute(
      "aria-label",
      `Mark ${card.name} as collected`
    );

    checkbox.addEventListener(
      "change",
      (event) => {
        event.stopPropagation();

        if (
          checkbox.checked
        ) {
          state.checkedCards.add(
            card.key
          );
        } else {
          state.checkedCards.delete(
            card.key
          );
        }

        recomputeResults();
      }
    );

    checkLabel.appendChild(
      checkbox
    );

    wrapper.appendChild(
      checkLabel
    );
  }

  const button =
    document.createElement(
      "button"
    );

  button.type =
    "button";

  button.className =
    "card-chip-button";

  button.title =
    "Hover or focus for all paper printings";

  const label =
    document.createElement(
      "span"
    );

  label.textContent =
    `${card.count}× ${card.name}`;

  button.appendChild(
    label
  );

  if (
    duplicate
  ) {
    const warning =
      document.createElement(
        "span"
      );

    warning.className =
      "duplicate-warning";

    warning.textContent =
      `⚠ Also shown in ${
        displayedLocationCount - 1
      } other location${
        displayedLocationCount - 1 === 1
          ? ""
          : "s"
      }`;

    button.appendChild(
      warning
    );
  }

  button.addEventListener(
    "click",
    () => {
      if (
        window.matchMedia(
          "(hover: none)"
        ).matches
      ) {
        wrapper.classList.toggle(
          "open"
        );
      }
    }
  );

  const tooltip =
    document.createElement(
      "div"
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

    img.src =
      image;

    img.alt =
      `${card.name} card image`;

    img.loading =
      "lazy";

    tooltip.appendChild(
      img
    );
  } else {
    const spacer =
      document.createElement(
        "div"
      );

    tooltip.appendChild(
      spacer
    );
  }

  const details =
    document.createElement(
      "div"
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

  if (
    duplicate
  ) {
    const duplicateNote =
      document.createElement(
        "div"
      );

    duplicateNote.className =
      "placement-note";

    duplicateNote.textContent =
      `⚠ This card is currently displayed in ${
        displayedLocationCount
      } result locations.`;

    details.appendChild(
      duplicateNote
    );
  }

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

  const setRows =
    buildCardSetRows(
      card
    );

  for (
    const rowData of
      setRows
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
            rarityRank(
              a
            ) -
              rarityRank(
                b
              ) ||
            a.localeCompare(
              b
            )
        )
        .map(
          prettyRarity
        )
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

  /*
   * Placement editor is only available when the card has at least
   * one currently valid storage location.
   */
  if (
    analysis &&
    cardIndex !== null &&
    !unavailable
  ) {
    const options =
      getAllowedLocationsForCard(
        cardIndex,
        analysis
      );

    const automaticLocation =
      findAutomaticLocation(
        cardIndex,
        analysis
      );

    if (
      options.length > 0 &&
      automaticLocation
    ) {
      const placementControls =
        document.createElement(
          "div"
        );

      placementControls.className =
        "placement-controls";

      const placementTitle =
        document.createElement(
          "span"
        );

      placementTitle.className =
        "placement-title";

      placementTitle.textContent =
        "Show this card under:";

      placementControls.appendChild(
        placementTitle
      );

      const placementHelp =
        document.createElement(
          "div"
        );

      placementHelp.className =
        "placement-help-small";

      placementHelp.textContent =
        "The recommended location is marked. " +
        "You may check multiple locations.";

      placementControls.appendChild(
        placementHelp
      );

      const optionsContainer =
        document.createElement(
          "div"
        );

      optionsContainer.className =
        "placement-options";

      const currentManual =
        getCurrentManualPlacements(
          card,
          cardIndex,
          analysis
        );

      const selectedKeys =
        currentManual.length > 0
          ? new Set(
              currentManual
            )
          : new Set([
              automaticLocation.key,
            ]);

      const solutionKeys =
        analysis.solution
          ? new Set(
              analysis.solution.selected.map(
                (index) =>
                  analysis
                    .solution
                    .candidates[
                      index
                    ]
                    .key
              )
            )
          : new Set();

      const sortedOptions =
        [...options].sort(
          (a, b) => {
            const aRecommended =
              solutionKeys.has(
                a.key
              );

            const bRecommended =
              solutionKeys.has(
                b.key
              );

            if (
              aRecommended !==
              bRecommended
            ) {
              return aRecommended
                ? -1
                : 1;
            }

            return compareCandidates(
              a,
              b
            );
          }
        );

      for (
        const location of
          sortedOptions
      ) {
        const optionLabel =
          document.createElement(
            "label"
          );

        optionLabel.className =
          "placement-option";

        if (
          solutionKeys.has(
            location.key
          )
        ) {
          optionLabel.classList.add(
            "recommended"
          );
        }

        const optionCheckbox =
          document.createElement(
            "input"
          );

        optionCheckbox.type =
          "checkbox";

        optionCheckbox.checked =
          selectedKeys.has(
            location.key
          );

        optionCheckbox.value =
          location.key;

        const optionText =
          document.createElement(
            "span"
          );

        let displayText =
          `${location.setName} (${location.setCode.toUpperCase()})`;

        if (
          mode !== "sets"
        ) {
          displayText +=
            ` · ${prettyRarity(
              location.rarity
            )}`;
        }

        if (
          location.key ===
          automaticLocation.key
        ) {
          displayText +=
            " · current";
        } else if (
          solutionKeys.has(
            location.key
          )
        ) {
          displayText +=
            " · recommended";
        } else {
          displayText +=
            " · other valid location";
        }

        optionText.textContent =
          displayText;

        optionLabel.append(
          optionCheckbox,
          optionText
        );

        optionsContainer.appendChild(
          optionLabel
        );

        optionCheckbox.addEventListener(
          "change",
          () => {
            const selected =
              [
                ...optionsContainer.querySelectorAll(
                  'input[type="checkbox"]:checked'
                ),
              ].map(
                (input) =>
                  input.value
              );

            updateManualPlacements(
              card,
              cardIndex,
              selected,
              automaticLocation.key
            );

            recomputeResults();
          }
        );
      }

      placementControls.appendChild(
        optionsContainer
      );

      const resetButton =
        document.createElement(
          "button"
        );

      resetButton.type =
        "button";

      resetButton.className =
        "placement-reset";

      resetButton.textContent =
        "Use optimized placement";

      resetButton.addEventListener(
        "click",
        (event) => {
          event.stopPropagation();

          state.manualPlacements.delete(
            card.key
          );

          recomputeResults();
        }
      );

      placementControls.appendChild(
        resetButton
      );

      const activeManual =
        getCurrentManualPlacements(
          card,
          cardIndex,
          analysis
        );

      const hasNonSolutionManual =
        activeManual.some(
          (locationKey) =>
            !solutionKeys.has(
              locationKey
            )
        );

      if (
        activeManual.length >
        1 ||
        hasNonSolutionManual
      ) {
        const note =
          document.createElement(
            "div"
          );

        note.className =
          "placement-note";

        const messages =
          [];

        if (
          activeManual.length >
          1
        ) {
          messages.push(
            `Displayed in ${activeManual.length} locations.`
          );
        }

        if (
          hasNonSolutionManual
        ) {
          messages.push(
            "At least one location is outside the optimized solution."
          );
        }

        note.textContent =
          messages.join(
            " "
          );

        placementControls.appendChild(
          note
        );
      }

      tooltip.appendChild(
        placementControls
      );
    }
  }

  tooltip.appendChild(
    details
  );

  wrapper.append(
    button,
    tooltip
  );

  return wrapper;
}


function findAutomaticLocation(
  cardIndex,
  analysis
) {
  if (
    !analysis.solution
  ) {
    return null;
  }

  return (
    analysis.solution
      .selected
      .map(
        (index) =>
          analysis
            .solution
            .candidates[
              index
            ]
      )
      .find(
        (location) =>
          location.cardIndexes.includes(
            cardIndex
          )
      ) ||
    null
  );
}


function buildCardSetRows(
  card
) {
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
      !setRows.has(
        code
      )
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
      setRows.get(
        code
      );

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

  return [
    ...setRows.values(),
  ];
}


/* ============================================================
   Unavailable cards
   ============================================================ */

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
        {
          unavailable:
            true,
        }
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


function getUnavailableReason(
  card
) {
  const hasNonSetMatch =
    card.printings.some(
      (printing) =>
        passesNonSetFilters(
          printing
        )
    );

  if (
    !hasNonSetMatch
  ) {
    if (
      state.ignoreLands &&
      card.printings.every(
        (printing) =>
          isLandPrinting(
            printing
          )
      )
    ) {
      return (
        "Excluded because lands are being ignored."
      );
    }

    if (
      state.enabledRarities.size ===
      0
    ) {
      return (
        "Excluded because every rarity is toggled off."
      );
    }

    return (
      "No printing matches the enabled rarity and land filters."
    );
  }

  return (
    "All matching printings are in sets that are currently disabled."
  );
}


/* ============================================================
   Set filter rendering
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
    entries.length ===
    0
  ) {
    setListEl.innerHTML = `
      <div class="empty-state">
        No matching sets.
      </div>
    `;
  }
}


function countSetCoverage(
  setCode
) {
  let count =
    0;

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
   Missing card rendering
   ============================================================ */

function renderMissing(
  missing
) {
  missingEl.innerHTML =
    "";

  if (
    missing.length ===
    0
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
   Utility
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
  if (
    !rarity
  ) {
    return "";
  }

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


function getBestImage(
  printings
) {
  return (
    printings.find(
      (printing) =>
        printing.image
    )?.image ||
    null
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
  let count =
    0;

  while (
    value
  ) {
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
   Cache/settings persistence
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
        ? value.enabledRarities
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

    state.darkMode =
      Boolean(
        value.darkMode
      );

    state.sortMode =
      [
        "default",
        "alphabetical",
        "coverage",
      ].includes(
        value.sortMode
      )
        ? value.sortMode
        : "default";
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

    state.darkMode =
      false;

    state.sortMode =
      "default";
  }
}


function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        disabledSets:
          [
            ...state.disabledSets,
          ].map(
            (code) =>
              code.toUpperCase()
          ),

        enabledRarities:
          [
            ...state.enabledRarities,
          ],

        ignoreLands:
          state.ignoreLands,

        checklistEnabled:
          state.checklistEnabled,

        darkMode:
          state.darkMode,

        sortMode:
          state.sortMode,
      })
    );
  } catch (_) {
    // Ignore unavailable storage.
  }
}