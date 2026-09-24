const API_BASE = "https://api.scryfall.com";

const CACHE_KEY = "mtg-bulk-scout-card-cache-v1";
const SETTINGS_KEY = "mtg-bulk-scout-settings-v1";

const CACHE_MAX_AGE_MS =
  30 * 24 * 60 * 60 * 1000;

// ~6.7 requests/sec, deliberately below Scryfall's requested ceiling.
const REQUEST_INTERVAL_MS = 150;

// Exact set-cover search can get expensive on complicated decklists.
const SOLVER_TIME_LIMIT_MS = 3500;

const state = {
  cards: [],
  setMeta: new Map(),
  disabledSets: new Set(),
  analyzed: false,
};

let cache = loadCache();
let lastRequestAt = 0;
let activeRun = 0;

const $ = (id) => document.getElementById(id);

const decklistEl = $("decklist");
const analyzeBtn = $("analyzeBtn");
const statusEl = $("status");
const setPanel = $("setPanel");
const setListEl = $("setList");
const setFilterEl = $("setFilter");
const resultsPanel = $("resultsPanel");
const resultsEl = $("results");
const summaryEl = $("summary");
const missingPanel = $("missingPanel");
const missingEl = $("missing");
const progressEl = $("progress");

loadSettings();

analyzeBtn.addEventListener("click", analyzeDeck);

setFilterEl.addEventListener("input", renderSetFilters);

$("enableAll").addEventListener("click", () => {
  state.disabledSets.clear();

  saveSettings();
  renderSetFilters();
  recomputeResults();
});

$("disableAll").addEventListener("click", () => {
  for (const code of state.setMeta.keys()) {
    state.disabledSets.add(code);
  }

  saveSettings();
  renderSetFilters();
  recomputeResults();
});

$("clearCache").addEventListener("click", () => {
  cache = {};
  saveCache();

  setStatus("Scryfall lookup cache cleared.");
});

document.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener("change", recomputeResults);
});

setListEl.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-set-code]");

  if (!input) {
    return;
  }

  const code = input.dataset.setCode;

  if (input.checked) {
    state.disabledSets.delete(code);
  } else {
    state.disabledSets.add(code);
  }

  saveSettings();
  recomputeResults();
});

// On touchscreen devices there is no hover, so tapping a card toggles
// its preview instead.
document.addEventListener("click", (event) => {
  const chip = event.target.closest(".card-chip");

  document.querySelectorAll(".card-chip.open").forEach((el) => {
    if (el !== chip) {
      el.classList.remove("open");
    }
  });

  if (chip && window.matchMedia("(hover: none)").matches) {
    chip.classList.toggle("open");
  }
});


/* ============================================================
   Deck processing
   ============================================================ */

async function analyzeDeck() {
  const runId = ++activeRun;
  const cards = parseDecklist(decklistEl.value);

  if (cards.length === 0) {
    setStatus("Enter at least one card in the decklist.", true);
    return;
  }

  analyzeBtn.disabled = true;

  resultsPanel.hidden = true;
  missingPanel.hidden = true;
  progressEl.hidden = false;
  setPanel.hidden = true;

  state.analyzed = false;
  state.cards = [];
  state.setMeta.clear();

  resultsEl.innerHTML = "";

  const resolved = [];
  const missing = [];

  try {
    for (let i = 0; i < cards.length; i++) {
      if (runId !== activeRun) {
        return;
      }

      const entry = cards[i];

      setStatus(
        `Looking up ${i + 1} of ${cards.length}: ${entry.name}`
      );

      try {
        const lookup = await lookupCard(entry.name);

        resolved.push({
          key: entry.key,
          inputName: entry.name,
          name: lookup.name,
          count: entry.count,
          printings: lookup.printings,
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

    state.cards = resolved;

    buildSetMetadata();
    initializeUnknownSetsAsEnabled();

    state.analyzed = true;

    progressEl.hidden = true;
    setPanel.hidden = false;
    resultsPanel.hidden = false;
    missingPanel.hidden = missing.length === 0;

    renderMissing(missing);
    renderSetFilters();
    recomputeResults();

    const fuzzyCount =
      resolved.filter((card) => card.fuzzy).length;

    let suffix = "";

    if (fuzzyCount > 0) {
      suffix =
        ` ${fuzzyCount} card${fuzzyCount === 1 ? " was" : "s were"} ` +
        "fuzzy-matched.";
    }

    setStatus(
      `Resolved ${resolved.length} of ${cards.length} unique ` +
      `card${cards.length === 1 ? "" : "s"}.${suffix}`
    );
  } catch (error) {
    progressEl.hidden = true;
    setStatus(error.message, true);
  } finally {
    analyzeBtn.disabled = false;
  }
}


/*
 * Supported examples:
 *
 *   4 Lightning Bolt
 *   4x Lightning Bolt
 *   Lightning Bolt x4
 *   1 Lightning Bolt (M11) 149
 *   1 Lightning Bolt [M11] 149
 *
 * Blank lines, comments, and simple Commander/Sideboard headers
 * are ignored.
 */
function parseDecklist(text) {
  const map = new Map();

  const lines = text.split(/\r?\n/);

  for (const raw of lines) {
    let line = raw.trim();

    if (!line) {
      continue;
    }

    if (
      /^(?:sideboard|commander|companion|mainboard|deck)\s*:?$/i.test(line)
    ) {
      continue;
    }

    if (
      /^(?:sideboard|commander|companion)\s*:/i.test(line)
    ) {
      continue;
    }

    if (/^[#/]/.test(line)) {
      continue;
    }

    line = line.replace(
      /^\*?\s*(?:sb|sideboard)\s*:\s*/i,
      ""
    );

    let count = 1;
    let name = line;

    let match = line.match(
      /^(\d+)\s*[x×]?\s+(.+)$/i
    );

    if (match) {
      count = Number.parseInt(match[1], 10);
      name = match[2].trim();
    } else {
      match = line.match(
        /^(.+?)\s+[x×](\d+)$/i
      );

      if (match) {
        name = match[1].trim();
        count = Number.parseInt(match[2], 10);
      }
    }

    // Remove common export annotations.
    //
    // Example:
    //   Lightning Bolt (M11) 149
    //   Lightning Bolt [M11] 149
    //
    name = name
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

    const key = normalizeName(name);

    const existing = map.get(key);

    if (existing) {
      existing.count += count;
    } else {
      map.set(key, {
        key,
        name,
        count,
      });
    }
  }

  return [...map.values()];
}


/* ============================================================
   Scryfall
   ============================================================ */

async function lookupCard(inputName) {
  const key = normalizeName(inputName);

  const cached = cache[key];

  if (
    cached &&
    Date.now() - cached.fetchedAt < CACHE_MAX_AGE_MS
  ) {
    return cached.value;
  }

  /*
   * !"<name>" = exact card-name match
   * unique=prints = return individual printings
   */
  const query = `!"${inputName}"`;

  const searchUrl =
    `${API_BASE}/cards/search?` +
    new URLSearchParams({
      q: query,
      unique: "prints",
      order: "released",
    });

  let cards = await fetchAllSearchPages(searchUrl);

  let fuzzy = false;
  let resolvedName = inputName;

  /*
   * Exact lookup failed.
   *
   * Try Scryfall's fuzzy named endpoint. It gives us a canonical
   * card object and a prints_search_uri for all of its printings.
   */
  if (cards.length === 0) {
    const namedUrl =
      `${API_BASE}/cards/named?` +
      new URLSearchParams({
        fuzzy: inputName,
      });

    const named = await fetchJson(namedUrl);

    resolvedName = named.name;
    fuzzy = true;

    if (!named.prints_search_uri) {
      cards = [named];
    } else {
      cards = await fetchAllSearchPages(
        named.prints_search_uri
      );
    }
  }

  /*
   * We only care about physical cards.
   *
   * This filters out purely digital printings such as Arena/MTGO
   * copies while leaving physical promo and supplemental sets
   * available for the user's set filter.
   */
  const printings = cards
    .filter(
      (card) =>
        Array.isArray(card.games) &&
        card.games.includes("paper")
    )
    .map(toPrinting)
    .filter(
      (printing) =>
        printing.setCode &&
        printing.setName
    );

  if (printings.length === 0) {
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


async function fetchAllSearchPages(firstUrl) {
  let url = firstUrl;

  const all = [];
  let safety = 0;

  while (url && safety++ < 100) {
    const data = await fetchJson(url);

    all.push(...(data.data || []));

    url = data.has_more
      ? data.next_page
      : null;
  }

  return all;
}


async function fetchJson(url) {
  await waitForRateLimit();

  let response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  /*
   * Handle one 429 response rather than repeatedly hammering
   * the API.
   */
  if (response.status === 429) {
    const retryAfter =
      Number.parseFloat(
        response.headers.get("Retry-After")
      ) || 2;

    await sleep(
      Math.max(1500, retryAfter * 1000)
    );

    await waitForRateLimit();

    response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });
  }

  if (!response.ok) {
    let detail = "";

    try {
      const body = await response.json();

      if (body.details) {
        detail = ` ${body.details}`;
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
    performance.now() - lastRequestAt;

  if (elapsed < REQUEST_INTERVAL_MS) {
    await sleep(
      REQUEST_INTERVAL_MS - elapsed
    );
  }

  lastRequestAt = performance.now();
}


function toPrinting(card) {
  return {
    setCode: card.set,
    setName: card.set_name,
    rarity: card.rarity,
    releasedAt:
      card.released_at || "9999-12-31",

    image:
      getImageUri(card),

    scryfallUri:
      card.scryfall_uri ||
      `https://scryfall.com/card/${card.set}/${card.collector_number}`,
  };
}


function getImageUri(card) {
  return (
    card.image_uris?.normal ||
    card.card_faces?.[0]?.image_uris?.normal ||
    null
  );
}


/* ============================================================
   Set metadata / filtering
   ============================================================ */

function buildSetMetadata() {
  state.setMeta.clear();

  for (const card of state.cards) {
    const seen = new Set();

    for (const printing of card.printings) {
      if (seen.has(printing.setCode)) {
        continue;
      }

      seen.add(printing.setCode);

      if (!state.setMeta.has(printing.setCode)) {
        state.setMeta.set(
          printing.setCode,
          {
            code: printing.setCode,
            name: printing.setName,
            releasedAt: printing.releasedAt,
          }
        );
      }
    }
  }
}


function initializeUnknownSetsAsEnabled() {
  for (const code of [...state.disabledSets]) {
    if (!state.setMeta.has(code)) {
      state.disabledSets.delete(code);
    }
  }

  saveSettings();
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

  const solution = solveForMode(mode);

  if (!solution) {
    summaryEl.innerHTML = `
      <div class="empty-state error">
        No solution exists with the currently enabled sets.
        Enable at least one set containing each card.
      </div>
    `;

    resultsEl.innerHTML = "";

    return;
  }

  renderSummary(solution, mode);
  renderResults(solution, mode);
}


/*
 * Build the set-cover candidates.
 *
 * Normal mode:
 *
 *     candidate = set
 *
 * Rarity mode:
 *
 *     candidate = set + rarity
 *
 * Each candidate has a BigInt bitmask indicating which deck
 * cards it can satisfy.
 */
function solveForMode(mode) {
  const universeSize = state.cards.length;

  const candidates = new Map();

  for (
    let cardIndex = 0;
    cardIndex < state.cards.length;
    cardIndex++
  ) {
    const card = state.cards[cardIndex];

    const seenLocations = new Set();

    for (const printing of card.printings) {
      if (
        state.disabledSets.has(
          printing.setCode
        )
      ) {
        continue;
      }

      const locationKey =
        mode === "sets"
          ? printing.setCode
          : `${printing.setCode}|${printing.rarity}`;

      if (seenLocations.has(locationKey)) {
        continue;
      }

      seenLocations.add(locationKey);

      if (!candidates.has(locationKey)) {
        candidates.set(
          locationKey,
          {
            key: locationKey,
            setCode: printing.setCode,
            setName: printing.setName,

            rarity:
              mode === "sets"
                ? null
                : printing.rarity,

            releasedAt: printing.releasedAt,

            mask: 0n,
          }
        );
      }

      candidates.get(locationKey).mask |=
        1n << BigInt(cardIndex);
    }
  }

  const candidateList =
    dedupeAndReduceCandidates(
      [...candidates.values()]
    );

  return solveSetCover(
    candidateList,
    universeSize
  );
}


/*
 * If two sets cover exactly the same deck cards, keep only one.
 *
 * Then remove dominated candidates:
 *
 *   If Set A covers a subset of Set B,
 *   checking Set A can never be better than
 *   checking Set B because both cost one location.
 */
function dedupeAndReduceCandidates(candidates) {
  const byMask = new Map();

  for (const candidate of candidates) {
    if (candidate.mask === 0n) {
      continue;
    }

    const key = candidate.mask.toString();

    const existing = byMask.get(key);

    if (
      !existing ||
      compareCandidates(
        candidate,
        existing
      ) < 0
    ) {
      byMask.set(key, candidate);
    }
  }

  const deduped =
    [...byMask.values()].sort(
      (a, b) => {
        const diff =
          popcount(b.mask) -
          popcount(a.mask);

        return (
          diff ||
          compareCandidates(a, b)
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

    reduced.push(candidate);
  }

  return reduced;
}


function compareCandidates(a, b) {
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

  return a.key.localeCompare(b.key);
}


/*
 * Exact minimum set cover using branch and bound.
 *
 * BigInt is used for the bitset so the deck can contain well
 * over 32 unique cards.
 */
function solveSetCover(
  candidates,
  universeSize
) {
  const fullMask =
    (1n << BigInt(universeSize)) -
    1n;

  if (universeSize === 0) {
    return {
      selected: [],
      candidates,
      optimal: true,
      timeMs: 0,
    };
  }

  /*
   * For each card, keep a list of candidate locations
   * that contain it.
   */
  const covering =
    Array.from(
      {
        length: universeSize,
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

      covering[bitIndex].push(ci);

      mask ^= lsb;
    }
  }

  /*
   * If any card has no candidate set, the problem is impossible.
   */
  for (const options of covering) {
    if (options.length === 0) {
      return null;
    }
  }

  /*
   * Start with a greedy solution.
   *
   * This gives branch-and-bound an upper bound immediately.
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

    if (covered === fullMask) {
      if (
        chosen.length <
        best.length
      ) {
        best = [...chosen];
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
      (fullMask & covered);

    const uncoveredCount =
      popcount(uncovered);

    /*
     * Choose the uncovered card having the fewest
     * remaining candidate locations.
     *
     * This is the most useful branching heuristic here.
     */
    let targetCard = -1;
    let targetOptions = null;

    /*
     * Maximum number of currently uncovered cards that
     * any candidate can cover.
     *
     * Used for a lower-bound pruning calculation.
     */
    let maxGain = 0;

    for (
      let cardIndex = 0;
      cardIndex < universeSize;
      cardIndex++
    ) {
      const bit =
        1n << BigInt(cardIndex);

      if (
        (covered & bit) !== 0n
      ) {
        continue;
      }

      const options = [];

      for (
        const ci of
        covering[cardIndex]
      ) {
        const gainMask =
          candidates[ci].mask &
          uncovered;

        if (gainMask !== 0n) {
          options.push(ci);
        }

        const gain =
          popcount(gainMask);

        if (gain > maxGain) {
          maxGain = gain;
        }
      }

      if (options.length === 0) {
        return;
      }

      if (
        targetOptions === null ||
        options.length <
          targetOptions.length
      ) {
        targetCard = cardIndex;
        targetOptions = options;
      }
    }

    if (
      maxGain === 0 ||
      targetCard < 0 ||
      targetOptions === null
    ) {
      return;
    }

    /*
     * Lower bound:
     *
     * If the best candidate covers 6 remaining cards
     * and 20 remain, at least ceil(20/6) = 4 additional
     * locations are required.
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

    /*
     * Try the candidate locations that cover the selected
     * card, largest gain first.
     */
    targetOptions.sort(
      (a, b) => {
        const gainA =
          popcount(
            candidates[a].mask &
              uncovered
          );

        const gainB =
          popcount(
            candidates[b].mask &
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
      const ci of targetOptions
    ) {
      dfs(
        covered |
          candidates[ci].mask,
        [...chosen, ci]
      );

      if (timedOut) {
        return;
      }
    }
  }

  dfs(0n, []);

  return {
    selected: best,
    candidates,
    optimal: !timedOut,
    timeMs:
      Math.round(
        performance.now() -
          started
      ),
  };
}


/*
 * Greedy upper-bound solution:
 *
 * Repeatedly choose the set that covers the largest number
 * of currently uncovered cards.
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
          candidates[i].mask &
            (fullMask ^
              (fullMask &
                covered))
        );

      if (gain > bestGain) {
        bestGain = gain;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) {
      return null;
    }

    selected.push(bestIndex);

    covered |=
      candidates[bestIndex].mask;
  }

  return selected;
}


/* ============================================================
   Result rendering
   ============================================================ */

function renderSummary(
  solution,
  mode
) {
  const setCount =
    new Set(
      solution.selected.map(
        (i) =>
          solution.candidates[i]
            .setCode
      )
    ).size;

  const locations =
    solution.selected.length;

  const totalCards =
    state.cards.reduce(
      (sum, card) =>
        sum + card.count,
      0
    );

  const uniqueCards =
    state.cards.length;

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

  const proof =
    solution.optimal
      ? `Minimum proven by the exact solver (${solution.timeMs} ms).`
      : `Best solution found within the ${
          SOLVER_TIME_LIMIT_MS / 1000
        }-second solver limit; minimum not proven.`;

  summaryEl.innerHTML = `
    <div class="summary-stat">
      <strong>${primary}</strong>
      <span>
        ${uniqueCards} unique cards ·
        ${totalCards} total copies
      </span>
    </div>

    <div class="solver-note">
      ${proof}
    </div>
  `;
}


function renderResults(
  solution,
  mode
) {
  /*
   * The selected sets may overlap. Assign each card to one
   * of the selected locations so every card appears exactly
   * once in the output.
   */
  const assignment = new Map();

  const selected =
    solution.selected.map(
      (index) =>
        solution.candidates[index]
    );

  for (
    let cardIndex = 0;
    cardIndex < state.cards.length;
    cardIndex++
  ) {
    const bit =
      1n << BigInt(cardIndex);

    const location =
      selected.find(
        (candidate) =>
          (candidate.mask &
            bit) !== 0n
      );

    if (location) {
      assignment.set(
        cardIndex,
        location.key
      );
    }
  }

  const groups = new Map();

  for (const location of selected) {
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

  if (mode === "sets") {
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

  resultsEl.innerHTML = "";

  for (
    let i = 0;
    i < groupList.length;
    i++
  ) {
    const {
      location,
      cardIndexes,
    } = groupList[i];

    const section =
      document.createElement(
        "section"
      );

    section.className =
      "result-set";

    const heading =
      document.createElement(
        "div"
      );

    heading.className =
      "result-heading";

    heading.innerHTML = `
      <div>
        <h3>
          ${escapeHtml(
            location.setName
          )}
          <code>
            ${escapeHtml(
              location.setCode
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
      </div>

      <span>
        ${cardIndexes.length}
        unique card${
          cardIndexes.length === 1
            ? ""
            : "s"
        }
      </span>
    `;

    const list =
      document.createElement(
        "div"
      );

    list.className =
      "card-list";

    cardIndexes.sort(
      (a, b) =>
        state.cards[a].name
          .localeCompare(
            state.cards[b].name
          )
    );

    for (
      const cardIndex of cardIndexes
    ) {
      list.appendChild(
        createCardChip(
          state.cards[cardIndex]
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


/*
 * Card result chip.
 *
 * Hover/focus:
 *   - shows Scryfall card image
 *   - lists every paper set
 *   - marks disabled sets as ignored
 */
function createCardChip(card) {
  const button =
    document.createElement(
      "button"
    );

  button.type = "button";
  button.className =
    "card-chip";

  button.title =
    "Hover or focus for all printings";

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
    img.loading = "lazy";

    tooltip.appendChild(img);
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

  const setsTitle =
    document.createElement(
      "span"
    );

  setsTitle.className =
    "tooltip-subtitle";

  setsTitle.textContent =
    "Printings in paper sets:";

  details.appendChild(
    setsTitle
  );

  const setsList =
    document.createElement(
      "span"
    );

  setsList.className =
    "tooltip-sets";

  const seen = new Set();

  const sortedPrintings =
    [...card.printings].sort(
      (a, b) =>
        a.releasedAt.localeCompare(
          b.releasedAt
        ) ||
        a.setName.localeCompare(
          b.setName
        )
    );

  for (
    const printing of sortedPrintings
  ) {
    if (
      seen.has(
        printing.setCode
      )
    ) {
      continue;
    }

    seen.add(
      printing.setCode
    );

    const row =
      document.createElement(
        "span"
      );

    const ignored =
      state.disabledSets.has(
        printing.setCode
      );

    row.className =
      ignored ? "ignored" : "";

    row.textContent =
      `${printing.setName} (${printing.setCode})` +
      (ignored
        ? " — ignored"
        : "");

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


function getBestImage(printings) {
  return (
    printings.find(
      (printing) =>
        printing.image
    )?.image ||
    null
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

  setListEl.innerHTML = "";

  const entries =
    [...state.setMeta.values()]
      .filter((set) => {
        if (!filter) {
          return true;
        }

        return (
          normalizeName(
            set.name
          ).includes(filter) ||
          set.code.includes(filter)
        );
      })
      .sort(
        (a, b) =>
          a.name.localeCompare(
            b.name
          )
      );

  for (const set of entries) {
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
      set.code;

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
          set.code
        )}
      </code>

      <small>
        ${coverage} unique deck card${
          coverage === 1
            ? ""
            : "s"
        }
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

  if (entries.length === 0) {
    setListEl.innerHTML =
      `<div class="empty-state">
        No matching sets.
      </div>`;
  }
}


function countSetCoverage(setCode) {
  let count = 0;

  for (const card of state.cards) {
    if (
      card.printings.some(
        (printing) =>
          printing.setCode ===
          setCode
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

function renderMissing(missing) {
  missingEl.innerHTML = "";

  if (missing.length === 0) {
    return;
  }

  for (const card of missing) {
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


function normalizeName(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}


function prettyRarity(rarity) {
  return (
    rarity.charAt(0).toUpperCase() +
    rarity.slice(1)
  );
}


function rarityRank(rarity) {
  const order = [
    "common",
    "uncommon",
    "rare",
    "mythic",
    "land",
    "bonus",
    "special",
  ];

  const index =
    order.indexOf(rarity);

  return index >= 0
    ? index + 1
    : 99;
}


function escapeHtml(value) {
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


/*
 * Count 1 bits in a BigInt.
 */
function popcount(value) {
  let count = 0;

  while (value) {
    value &= value - 1n;
    count++;
  }

  return count;
}


/*
 * BigInt equivalent of log2(value), where value is a power of two.
 */
function bigIntLog2(value) {
  return (
    value.toString(2).length - 1
  );
}


function sleep(ms) {
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
      JSON.stringify(cache)
    );
  } catch (_) {
    /*
     * Storage can be unavailable or full.
     * The application still works without caching.
     */
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
        value.disabledSets || []
      );
  } catch (_) {
    state.disabledSets =
      new Set();
  }
}


function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        disabledSets: [
          ...state.disabledSets,
        ],
      })
    );
  } catch (_) {
    // Ignore unavailable storage.
  }
}