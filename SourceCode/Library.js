/*
 * SmartCards
 * Copyright (c) 2025 KaiserSaphan
 * Licensed under Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International
 */
/*
SmartCards— v0.9.3
Author: KaiserSaphan, & Micah (refactor), inspired by AutoCards (LewdLeah)
 *
 * USAGE IN HOOKS (unchanged):
 *   text = SmartCards("input", text);
 *   [text, stop] = SmartCards("context", text, stop);
 *   text = SmartCards("output", text);
 */
/**
 * SmartCards — single entry point called by each AI Dungeon hook.
 * @param {'input'|'context'|'output'} hook - Which lifecycle phase is calling us.
 * @param {string} inText - The text provided by the host (player input or narrative).
 * @param {boolean} [inStop] - Host-provided "stop" signal (only meaningful for context).
 * @returns {string|[string, boolean]} 
 *   input/output -> returns the (possibly unchanged) text string.
 *   context      -> returns [text, stop] tuple expected by the host.
 *
 * WHY: Centralizes stateful behavior so all three tiny wrappers are dumb and safe.
 * BE CAREFUL: One pending job at a time (S.pending). Don't spawn nested jobs.
 */

function SmartCards(hook, inText, inStop) {
  "use strict";

  // ================================
  //  ENVIRONMENT GUARDS / POLYFILLS
  // ================================
  var _g = (typeof global !== 'undefined') ? global : (typeof window !== 'undefined' ? window : {});
  if (!_g.__SC_STATE__) _g.__SC_STATE__ = {};
  var _state = (typeof state !== 'undefined') ? state : _g.__SC_STATE__;
  var _info  = (typeof info  !== 'undefined') ? info  : { actionCount: 0 };
  var _hist  = (typeof history !== 'undefined') ? history : [];
  if (!_g.__SC_CARDS__) _g.__SC_CARDS__ = [];
  var _cards = (typeof storyCards !== 'undefined') ? storyCards : _g.__SC_CARDS__;
  var _add   = (typeof addStoryCard === 'function') ? addStoryCard : function(t){ _cards.push({ title:t, type:'class', keys:'', entry:'', description:'' }); };
  var TURN   = function(){ return (Number.isInteger(_info.actionCount)? _info.actionCount : (_hist? _hist.length:0))|0; };

  const CONFIG_CARD_TITLE = "SmartCards Config";

  // =================
  //  DEFAULT CONFIG
  // =================
  const DEFAULT_CFG = {
    enabled: true,
    // --- Core behavior ---
    cooldownTurns: 18,
    entryCharLimit: 650,
    memoryAutoUpdate: true,
    memoryCharLimit: 2200,
    ignoreAllCaps: true,
    lookback: 6,
    useBullets: true,
    scanBlockLimit: 4000,
    candidatesCap: 100,
    defaultType: "class",

    // --- Multi‑Trigger SmartCards (MTS) ---
    // Think of TTL as “how long the confetti sticks to the narrative floor.”
    triggerEnable: true,
    triggerTTL: 3,
    triggerMaxPerTurn: 3,
    triggerCaseInsensitive: true,
    triggerAnchor: "World Lore:\n",

    // --- Character typing aids... Doesn't help you type ---
    characterPronouns: "he, him, his, she, her, hers, they, them, their, theirs",
    relationshipWords: "father, mother, dad, mum, mom, son, daughter, sister, brother, husband, wife, spouse, partner, fiancée, fiancé, friend, buddy, mate, pal, rival, enemy, mentor, mentee, boss, chief, leader, captain, teacher, coach, boyfriend, girlfriend, ex",
    conjunctionGuard: true,

    // --- Per‑adventure scripts ---
    enableCardScripts: true,

    // --- Prompts ---
    generationPrompt: [
      "<SYSTEM>",
      "Write a concise, plot-relevant entry for %{title} in third person.",
      "Avoid temporary minutiae; prefer stable facts that matter to the story.",
      "Imitate the story's style.",
      "If a Focus is provided, weight content accordingly.",
      "</SYSTEM>",
      "Focus: %{focus}",
      "Current entry seed (may be empty):",
      "%{entry}"
    ].join("\n"),

    compressionPrompt: [
      "<SYSTEM>",
      "Task: extractive selection ONLY.",
      "You are given a list of memory bullets. Each bullet has a unique [#id].",
      "Return JSON ONLY with up to 20 ids to keep.",
      'Schema: {"keep":["#id", ...]}',
      "Rules: Do NOT invent ids. Prefer recent (higher T) and non-duplicates. If in doubt, omit.",
      "</SYSTEM>",
      "BULLETS:",
      "%{memory}",
      "JSON only:"
    ].join("\n"),

    banned:new Set("North,East,South,West,Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,January,February,March,April,May,June,July,August,September,October,November,December".split(","))
  };

if (_state.ACM == null) {
  _state.ACM = {
    config: DEFAULT_CFG,
    lastAutoTurn: -999,
    candidates: [],
    pending: null,
    lastAppliedTitle: null,
    MTS: { activeIdx: [], activeTTL: [], queuedIdx: [], turnHitCount: 0 }
  };
}
  const S = _state.ACM;
  const CFG = S.config = mergeCfg(DEFAULT_CFG, S.config||{});
  // Normalize 'banned' to a Set if a plain array/object slipped in
  if (!(CFG.banned instanceof Set)) {
    let src = CFG.banned;
    let arr = [];
    if (src && typeof src[Symbol.iterator] === 'function') arr = [...src];
    else if (Array.isArray(src)) arr = src;
    else if (typeof src === 'string') arr = src.split(',').map(s=>sanitizeTitle(s)).filter(Boolean);
    CFG.banned = new Set(arr);
  }

  // Normalize inputs from the host hooks
  const TEXT = typeof inText === 'string' ? normalize(inText) : "\\n";
  const STOP = inStop === true;

  // Early exit if globally disabled
  if (!CFG.enabled) return finalize(hook, TEXT, STOP);

  // ============================
  //  MAIN DISPATCH (per hook)
  // ============================
  try {
    switch(hook){
      case 'input':{
        const t = TEXT.trim();
        runCardScripts("beforeCommand", { raw: t, turn: TURN() });

        // Rich command: /ac <Title> / <Focus?> / <FirstLine?>
        const rich = t.match(/^\\s*\\/(?:ac|sc)\\s+(.+?)(?:\\s*\\/\\s*(.*?))?(?:\\s*\\/\\s*(.*?))?\\s*$/i);
        if (rich){
          const title = sanitizeTitle(rich[1]||'');
          const focus = sanitizeSoft(rich[2]||'');
          const first = sanitizeSoft(rich[3]||'');
          if (title) scheduleGenerate(title,{focus,first});
          runCardScripts("afterCommand", { type:"ac", mode:"create", title, focus, first, turn: TURN() });
          return finalize(hook, "\\n", STOP);
        }

        // Legacy toggles and helpers: /ac on|off|redo|ban|config
        if (/^\\s*\\/(?:ac|sc)\\b/i.test(t)){
          const mOn   = t.match(/\\bon\\b/i);
          const mOff  = t.match(/\\boff\\b/i);
          const mRedo = t.match(/\\bredo\\s+"?([^"]+)"?/i);
          const mBan  = t.match(/\\bban\\s+"?([^"]+)"?/i);
          const mCfg  = t.match(/\\bconfig\\b/i) || t.match(/\\bconfid\\b/i);

          if (mOn)  { CFG.enabled = true;  _state.message = "SmartCards: enabled."; }
          if (mOff) { CFG.enabled = false; _state.message = "SmartCards: disabled."; }
          if (mRedo){ const title = sanitizeTitle(mRedo[1]); scheduleGenerate(title,{redo:true}); }
          if (mBan) { CFG.banned.add(sanitizeTitle(mBan[1])); _state.message = "SmartCards: title banned."; }
          if (mCfg) { writeConfigCard(true); _state.message = "SmartCards: Config card created/updated."; }

          runCardScripts("afterCommand", { type:"ac", mode:"legacy", raw: t, turn: TURN() });
          return finalize(hook, "\\n", STOP);
        }

        if (CFG.triggerEnable) mtsDetectAndQueue(t);
          return finalize(hook, TEXT, STOP);
      }

      case 'context':{
        runCardScripts("turnStart", { turn: TURN() });
        runCardScripts("beforeContext", { text: TEXT, turn: TURN() });

        // Apply in‑game config edits, if any
        readConfigCard();

        // MTS: Activate queued triggers and inject matching entries before SmartCards system prompt.
        let __CTX_AFTER_MTS = TEXT;
        if (CFG.triggerEnable) {
          mtsActivateQueued();
          __CTX_AFTER_MTS = mtsInjectActive(__CTX_AFTER_MTS);
        }

        // If nothing is already queued, scan the recent history for new names
        if (!S.pending) scanForCandidates();

        if (S.pending){
          const msg = buildSystemMessage(S.pending);
          const updated = injectMessage(__CTX_AFTER_MTS, msg);
          runCardScripts("afterContext", { text: updated, turn: TURN() });
          return finalize(hook, updated, STOP);
        } else {
          runCardScripts("afterContext", { text: __CTX_AFTER_MTS, turn: TURN() });
          return finalize(hook, __CTX_AFTER_MTS, STOP);
        }
      }
case 'output':{
        if (S.pending){
          const prevPending = S.pending;
          try{
            applyPending(TEXT);
          } catch(e){
            _state.message = `SmartCards: apply failed (${String(e.message||e)})`;
          } finally { if (S.pending === prevPending) S.pending = null; }
        } else {
          const turn = TURN();
          if (turn - S.lastAutoTurn >= CFG.cooldownTurns){
            const cand = nextCandidate();
            if (cand){
              scheduleGenerate(cand.title, { sourceText: cand.sourceText });
              S.lastAutoTurn = turn;
              _state.message = `SmartCards: preparing "${cand.title}" card... press Continue.`;
            }
          }
        }
        if (CFG.triggerEnable) mtsDetectAndQueue(TEXT);
        runCardScripts("turnEnd", { turn: TURN() });
        return finalize(hook, TEXT, STOP);
      }

      default:
        return finalize(hook, TEXT, STOP);
    }
  } catch(err){
    _state.message = `SmartCards: ${String(err && err.message || err)}`;
    return finalize(hook, TEXT, STOP);
  }

  // ======================
  //  IMPLEMENTATION ZONE
  // ======================

  // --- Character typing helpers (I LIKE TURTLES) ---
  /**
 * Convert a CSV string into a lowercase Set.
 * @param {string} s
 * @returns {Set<string>}
 * WHY: Fast membership checks for pronouns/relationship words.
 * FOOTGUN: Leading/trailing spaces are trimmed; keep CSVs simple.
 */

  function _csvToSet(s) {
    const out = new Set();
    String(s || "").split(",").forEach(x => {
      const t = x.trim().toLowerCase();
      if (t) out.add(t);
    });
    return out;
  }
  /**
 * Detect conjunctions in a title.
 * @param {string} title
 * @returns {boolean}
 * WHY: Avoid cards like "Sarah and Jane" when you likely want two cards.
 * NUANCE: This will also flag creative names like "Salt & Silver" by design.
 */

  function hasConjunction(title) {
    const t = String(title || "").toLowerCase();
    return /\\band\\b|&/.test(t);
  }
  /**
 * Check if a passage contains pronouns from config.
 * @param {string} text
 * @param {object} cfg
 * @returns {boolean}
 * WHY: Helps nudge titles toward "character" classification.
 */

  function hasPronoun(text, cfg) {
    const set = _csvToSet(cfg.characterPronouns);
    const words = String(text || "").toLowerCase().match(/[a-z']+/g) || [];
    for (const w of words) if (set.has(w)) return true;
    return false;
  }
  /**
 * Check if a passage contains relationship words (father, mentor, etc.).
 * @param {string} text
 * @param {object} cfg
 * @returns {boolean}
 * WHY: Relationship words near a title mention are strong character signals.
 */

  function hasRelationshipWord(text, cfg) {
    const set = _csvToSet(cfg.relationshipWords);
    const words = String(text || "").toLowerCase().match(/[a-z’']+/g) || [];
    for (const w of words) if (set.has(w)) return true;
    return false;
  }
  /**
 * Find the first sentence that mentions a title (case-insensitive).
 * @param {string} title
 * @param {string} text
 * @returns {string} - The containing sentence or empty string.
 * WHY: Provides a natural seed line for entry generation.
 * PORTABILITY: Avoid heavy regex lookbehind in performance-critical paths.
 */

function sentenceContaining(title, text) {
  const t = String(text || "");
  const parts = t.split(/([.?!])/);
  const sentences = [];
  for (let i = 0; i < parts.length; i += 2) {
    const base = parts[i] || "";
    const punct = parts[i + 1] || "";
    const s = (base + punct).trim();
    if (s) sentences.push(s);
  }
  const rx = new RegExp("\\b" + _escapeRegex(String(title || "")) + "\\b", "i");
  for (const s of sentences) {
    if (rx.test(s)) return s;
  }
  return "";
}

  /**
 * Heuristic classifier for a title -> desired card type.
 * @param {string} title
 * @param {string} sourceText
 * @param {object} cfg
 * @returns {{desiredType: string, reason: string, score: number}}
 * WHY: Gives the generator a head start (e.g., "character" vs defaultType).
 * TUNING: Adjust thresholds if you expand the signals later.
 */


  function classifyTitle(title, sourceText, cfg){
    if (cfg.conjunctionGuard && hasConjunction(title)) {
      return { desiredType: cfg.defaultType, reason: "conjunction in title", score: 0 };
    }
    const sent = sentenceContaining(title, sourceText || "");
    let score = 0;
    if (hasRelationshipWord(title, cfg)) score += 2;
    if (hasRelationshipWord(sent,  cfg)) score += 2;
    if (hasPronoun(sent, cfg)) score += 1;
    if (score >= 2) return { desiredType: "character", reason: "rels/pronouns near mention", score };
    return { desiredType: cfg.defaultType, reason: "insufficient character signals", score };
  }

  // Scan recent history to queue candidate titles for auto‑generation.
  /**
 * Scan recent history for proper-noun-ish phrases to propose as cards.
 * Mutates S.candidates with unique, not-banned, not-used titles.
 * WHY: Background discovery that feels "smart" without being noisy.
 * SAFETY: Wear goggles, say the lords prayer. Respects CFG.candidatesCap and CFG.lookback to limit churn.
 */

  function scanForCandidates(){
    const start = Math.max(0, _hist.length - (CFG.lookback|0));
    const used = new Set(getUsedTitles().map(normTitle));
    for (let i=start;i<_hist.length;i++){
      const h=_hist[i];
      const block = (h&&typeof h.text==='string')? normalize(h.text).slice(0,CFG.scanBlockLimit):"";
      if (!block) continue;
      const found = extractTitles(block);
      for (const t of found){
        const k=normTitle(t);
        if (!k||used.has(k)||isBanned(t)) continue;
        if (CFG.conjunctionGuard && hasConjunction(t)) continue;
        S.candidates.push({title:t, turn:i, sourceText:block});
      }
    }
    const seen=new Set();
    S.candidates = S.candidates.filter(c=>{const k=normTitle(c.title); if(seen.has(k)) return false; seen.add(k); return true;});
    if (S.candidates.length>CFG.candidatesCap) S.candidates.splice(0,S.candidates.length-CFG.candidatesCap);
  }

  // Extract likely proper‑noun titles from a text block
  /**
 * Pull likely titles from a text block via capitalization heuristics.
 * @param {string} block
 * @returns {string[]} - Up to 24 unique candidate titles.
 * WHY: Quick and decent for Western scripts; tweak if your story differs.
 */

  function extractTitles(block){
    const out=new Set();
    const clean=block.replace(/[{}<>\\[\\]]/g," ").replace(/\\s+/g," ");
    let re=/\\b([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){1,3})\\b/g, m;
    while((m=re.exec(clean))){ const c=sanitizeTitle(m[1]); if(skipTitle(c)) continue; out.add(denumber(c)); }
    let re1=/\\b([A-Z][a-z]{3,})\\b/g, k;
    while((k=re1.exec(clean))){ const c=sanitizeTitle(k[1]); if(skipTitle(c)) continue; out.add(c); }
    return [...out].slice(0,24);
  }

  /**
 * Pop the newest candidate that isn't already used or banned.
 * @returns {{title: string, sourceText: string}|null}
 * WHY: Rate-limited background creation when the user keeps playing.
 */


  function nextCandidate(){
    const used=new Set(getUsedTitles().map(normTitle));
    while(S.candidates.length){
      const cand=S.candidates.pop()||{};
      const title=cand.title; const sourceText=cand.sourceText||"";
      if(!title) continue;
      const key=normTitle(title);
      if(!key||used.has(key)||isBanned(title)) continue;
      return { title, sourceText };
    }
    return null;
  }

  // Queue a generation job for a given title (optionally with focus/first line)
  /** Queue a generate job for this title. */
  /**
 * Queue a generate job for a title.
 * @param {string} title
 * @param {{focus?: string, first?: string, redo?: boolean, sourceText?: string}} [opts]
 * @returns {void}
 * WHY: Defers model work until the next hook (context/output) safely.
 * CONTRACT: Leaves S.pending set; only one pending job at a time.
 */

  function scheduleGenerate(title, opts={}){
    if (S.pending) return;
    const idx = findCardIndex(title);
    const card = idx>=0? _cards[idx]: null;

    let entrySeed = card? String(card.entry||"") : (CFG.useBullets? "- " : "");
    if (opts.first){ entrySeed = (CFG.useBullets? "- ":"") + opts.first.trim(); }

    runCardScripts("beforeGenerate", { title, entrySeed, card });

    const prompt = CFG.generationPrompt
      .replace(/%\\{title\\}/g,title)
      .replace(/%\\{focus\\}/g, String(opts.focus||''))
      .replace(/%\\{entry\\}/g, entrySeed);

    const sourceText = opts.sourceText || (card ? (String(card.entry||"") + "\\n" + String(card.description||"")) : "");
    const { desiredType } = classifyTitle(title, sourceText, CFG);

    S.pending = {
      mode:"generate",
      title,
      cardIndex: idx,
      payload:{ prompt, entrySeed, desiredType, redo: !!opts.redo }
    };
  }

  // Queue a compression job to prune long memories
  /**
 * Queue a compression job for a card's memory section.
 * @param {string} title
 * @param {number} idx - Card index
 * @param {string} memoryText - The current memory block
 * WHY: Keeps notes scannable; model returns JSON { keep: ['#id', ...] }.
 */

  function scheduleCompress(title, idx, memoryText){
    if (S.pending) return;
    const safeMem = clip(String(memoryText||""), CFG.memoryCharLimit*2);
    const prompt = CFG.compressionPrompt.replace(/%\\{memory\\}/g, safeMem);
    S.pending = { mode:"compress", title, cardIndex: idx, payload:{ prompt, sourceMemory: safeMem } };
  }

  // Build the system message injected into context for the pending job
  /**
 * Format the system message injected into the context for the pending job.
 * @param {object} p - Pending job
 * @returns {string}
 * WHY: Clear markers let us reliably extract only the model's answer later.
 */

  function buildSystemMessage(p){
    const prompt = clip(p.payload.prompt, 3200);
    return ">>> SmartCards: system prompt >>>\\n" + prompt + "\\n<<< end SmartCards <<<";
  }

  // Append the message to the end of the context
  /**
 * Append a system message to the current context.
 * @param {string} ctx
 * @param {string} msg
 * @returns {string}
 * WHY: Non-invasive context injection with explicit markers.
 */

  function injectMessage(ctx, msg){
    return ctx + "\\n\\n" + msg + "\\n\\n";
  }

  // Consume model output for the pending job and apply it to the target Story Card
  /** Apply the model's output for the queued job (generate/compress). */
  /**
 * Consume the model's output and apply it to the target card.
 * @param {string} modelText
 * @returns {void}
 * LIFECYCLE: Called from 'output'. Clears S.pending only if it's the same object captured.
 * EDGE CASES: If JSON keep list is malformed, we fallback to last 20 lines.
 */

  function applyPending(modelText){
    const p=S.pending; if(!p) return;
    const title=p.title; S.lastAppliedTitle=title;
    const desiredType = p.payload && p.payload.desiredType;

    const idx = (p.cardIndex>=0)? p.cardIndex : createCard(title, desiredType);
    if (idx<0||!_cards[idx]) return;
    const card=_cards[idx];

    if (desiredType && String(card.type||"").toLowerCase() === String(CFG.defaultType||"").toLowerCase()) {
      card.type = desiredType;
    }

    const payload = String(modelText||"");
    const segment = extractAfterMarker(payload) || payload;

    if (p.mode === 'generate'){
      let clean = clip(normalize(segment), CFG.entryCharLimit);
      const payloadObj = { title, entry: clean, card };
      runCardScripts("afterGenerate", payloadObj);
      clean = String(payloadObj.entry||clean);
      card.entry = formatEntry(clean, title);
      if (!/SmartCards\\s*Memories\\s*:/i.test(String(card.description||""))) card.description = `SmartCards Memories:\\n`;
      if (CFG.memoryAutoUpdate && String(card.description||"").length > CFG.memoryCharLimit && !(p.payload && p.payload.redo)){
        scheduleCompress(title, idx, card.description);
      }
    }
    else if (p.mode === 'compress'){
      const ids = parseKeepIds(segment);
      const lines = String(p.payload.sourceMemory||"").split("\\n");
      runCardScripts("beforeCompress", { title, memory: lines.slice(), card });
      const keep = [];
      if (ids.length){
        for (const id of ids){
          const line = lines.find(b=>b.includes(`[${id}]`));
          if(line) keep.push(line);
        }
      }
      const finalLines = keep.length? keep : lines.slice(-20);
      runCardScripts("afterCompress", { title, keptLines: finalLines.slice(), card });
      card.description = finalLines.join("\\n");
    }
  }

  // ==================================================
  //  PER‑ADVENTURE SCRIPT RUNNER (Olympic) ("SC Script:" cards)
  // ==================================================
  /**
 * Iterate over all "SC Script:" cards and invoke a callback.
 * @param {(card: object, index: number)=>void} fn
 * WHY: Enables per-adventure customization without shipping new code.
 */

  function eachScriptCard(fn){
    for (let i=0;i<_cards.length;i++){
      const c=_cards[i];
      if (!c || !c.title) continue;
      if (/^(?:SC|AC)\\s*Script\\s*:/i.test(String(c.title))) fn(c, i);
    }
  }
  /**
 * Extract JS code from a card description.
 * @param {object} card
 * @returns {string} - Raw JS; supports ```js fenced blocks.
 * SECURITY: Scripts run with a tiny API only; still treat as trusted content.
 */

  function extractScriptFromCard(card){
    const d = String(card.description||"");
    const m = d.match(/```js([\\s\\S]*?)```/i);
    return (m ? m[1] : d).trim();
  }
  /**
 * Build the micro-API exposed to card scripts.
 * @param {object} card
 * @returns {object} api
 * WHY: Keeps the surface small and auditable.
 */

  function apiForScripts(card){
    return {
      addMemory: (title,line)=>SmartCards.API.addMemory(title, line),
      message: (s)=>{ _state.message = String(s||""); },
      log: (...a)=>{ try{ console.log("[AC-Script]", ...a); }catch(_){}; },
      config: CFG,
      findCardIndex,
      renameCard: (idx, title)=>{ if (_cards[idx]) _cards[idx].title = String(title||""); },
      turn: TURN(),
      card,
    };
  }
  /**
 * Execute per-adventure scripts for a lifecycle event. Or end of life event.
 * @param {string} event - e.g., 'beforeGenerate'
 * @param {object} payload - Event-specific payload
 * RESILIENCE: Errors are caught and shown via state.message.
 */

  function runCardScripts(event, payload){
    if (!CFG.enableCardScripts) return;
    eachScriptCard((card, idx)=>{
      const code = extractScriptFromCard(card);
      if (!code) return;
      try{
        new Function("api","event","payload", code)(apiForScripts(card), event, payload);
      } catch(e){
        _state.message = `SC Script error in "${card.title}": ${String(e.message||e)}`;
      }
    });
  }


  // ==================================================
  //  Multi‑Trigger SmartCards (MTS) AKA MTS-500A GULF OIL RETRIEVAL SYSTEM!
  //  Injects card.entries for N turns when AND-sets of tokens appear
  //  in the same block (input/output). No mutation; context-only.
  //  Notes: Think of AND-lines as friendship bracelets: all beads
  //  must show up together before the bouncer lifts the velvet rope.
  // ==================================================

  /**
   * Parse card.keys into AND-sets. Commas separate lines. '&' joins tokens
   * that must co-occur. Lines without '&' are treated as single-token sets.
   * @param {string} keys
   * @returns {string[][]}
   */
  function mtsParseAndKeys(keys){
    const lines = String(keys||"").split(",").map(s=>s.trim()).filter(Boolean);
    const out = [];
    for (const line of lines){
      const parts = line.split("&").map(s=>s.trim()).filter(Boolean);
      if (parts.length) out.push(parts);
    }
    return out;
  }

  /** Escape regex special chars */
  function _mtsEscape(s){ return String(s||"").replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /**
   * Check whether a phrase (possibly multi-word) appears in text with
   * loose word boundaries (so "Bob's" matches bob).
   * @param {string} text
   * @param {string} phrase
   * @returns {boolean}
   */
  function mtsContainsToken(text, phrase){
    if (!phrase) return false;
    let hay = String(text||"");
    let tok = String(phrase||"");
    if (CFG.triggerCaseInsensitive){ hay = hay.toLowerCase(); tok = tok.toLowerCase(); }
    const words = tok.split(/\s+/).filter(Boolean).map(_mtsEscape);
    if (!words.length) return false;
    const pat = "\\b" + words.join("\\s+") + "\\b";
    try {
      const re = new RegExp(pat);
      return re.test(hay);
    } catch(_){ // If regex fails for any reason, fallback to simple includes
      return hay.indexOf(tok) !== -1;
    }
  }

  /**
   * Detect cards to trigger from a single text block (input or output).
   * @param {string} text
   * @returns {Set<number>}
   */
  function mtsDetectInBlock(text){
    const hits = new Set();
    const cap = (CFG.triggerMaxPerTurn|0) || 3;
    let used = 0;
    const t = String(text||"");
    for (let i=0;i<_cards.length;i++){
      const c = _cards[i];
      if (!c || !c.keys || !c.entry) continue;
      const sets = mtsParseAndKeys(c.keys);
      if (!sets.length) continue;
      let matched = false;
      for (const andSet of sets){
        let all = true;
        for (const token of andSet){
          if (!mtsContainsToken(t, token)){ all = false; break; }
        }
        if (all){ matched = true; break; }
      }
      if (matched){
        hits.add(i);
        used++;
        if (used >= cap) break;
      }
    }
    return hits;
  }

  /** Queue new trigger hits into S.MTS.queuedIdx (deduped). */
  function mtsDetectAndQueue(block){
    const hits = mtsDetectInBlock(block);
    if (!hits.size) return;
    const q = S.MTS.queuedIdx || (S.MTS.queuedIdx = []);
    for (const idx of hits){
      if (!q.includes(idx)) q.push(idx);
    }
  }

  /** Activate queued indices into activeIdx/activeTTL with fresh TTLs. */
  function mtsActivateQueued(){
    const q = S.MTS.queuedIdx || [];
    if (!q.length) return;
    S.MTS.queuedIdx = [];
    const ttl = toInt(CFG.triggerTTL, 3);
    for (const idx of q){
      const at = S.MTS.activeIdx.indexOf(idx);
      if (at === -1){
        S.MTS.activeIdx.push(idx);
        S.MTS.activeTTL.push(ttl);
      } else {
        S.MTS.activeTTL[at] = ttl; // reset if already active
      }
    }
  }

  /** Insert text right after the configured anchor, or at the end as fallback. */
  function mtsInsertAfterAnchor(ctx, insertString){
    const anchor = String(CFG.triggerAnchor||"");
    const chunk  = String(insertString||"").trim();
    if (!chunk) return ctx;
    if (anchor){
      const i = ctx.indexOf(anchor);
      if (i >= 0){
        return ctx.slice(0, i + anchor.length) + chunk + "\\n" + ctx.slice(i + anchor.length);
      }
    }
    return ctx + "\\n" + chunk + "\\n";
  }

  /**
   * Inject active entries (respect max per turn), decrement TTL, and prune.
   * Avoid duplicate insertion if the exact entry is already present.
   * @param {string} ctx
   * @returns {string}
   */
  function mtsInjectActive(ctx){
    let out = String(ctx||"");
    const cap = (CFG.triggerMaxPerTurn|0) || 3;
    let injected = 0;
    for (let i=0;i<S.MTS.activeIdx.length;i++){
      const idx = S.MTS.activeIdx[i];
      const ttl = S.MTS.activeTTL[i];
      const card = _cards[idx];
      if (!card || !card.entry) continue;
      const payload = String(card.entry).trim();
      if (!payload) continue;
      if (out.indexOf(payload) === -1 && injected < cap){
        // MTS: We only add confetti if it isn't already on the dance floor.
        out = mtsInsertAfterAnchor(out, payload);
        injected++;
      }
      S.MTS.activeTTL[i] = ttl - 1;
    }
    // Remove expired
    for (let i=S.MTS.activeIdx.length-1; i>=0; i--){
      if (S.MTS.activeTTL[i] <= 0){
        S.MTS.activeIdx.splice(i,1);
        S.MTS.activeTTL.splice(i,1);
      }
    }
    return out;
  }

  // =============================
  //  CONFIG CARD READ / WRITE
  // =============================
  /**
 * Create/update the "SmartCards Config" card with current settings.
 * @param {boolean} createIfMissing
 * @returns {boolean}
 * HOW TO USE: Edit the card notes as key: value lines, then continue.
 */

  function writeConfigCard(createIfMissing){
    let idx = findCardIndex(CONFIG_CARD_TITLE);
    if (idx < 0 && createIfMissing){ idx = createCard(CONFIG_CARD_TITLE); }
    if (idx < 0) return false;
    const card = _cards[idx];
    card.type = 'class';
    card.entry = 'Adjust SmartCards settings by editing the notes (key: value).';
    card.description = toConfigText(CFG);
    return true;
  }

  /**
 * Read and apply config edits from the "SmartCards Config" card.
 * @returns {boolean} - true if applied
 * NOTE: This applies during the 'context' phase before scheduling work.
 */


  function readConfigCard(){
    const idx = findCardIndex(CONFIG_CARD_TITLE);
    if (idx < 0) return false;
    const desc = String(_cards[idx].description||'');
    if (!desc.trim()) return false;
    const updates = parseConfigText(desc);
    if (!updates) return false;
    for (const [k,v] of Object.entries(updates)) applyConfigKV(k,v);
    return true;
  }

  /**
 * Serialize CFG to a human-editable notes block.
 * @param {object} cfg
 * @returns {string}
 * TIP: Keep keys short; complex structures are out-of-scope by design.
 */


  function toConfigText(cfg){
    const banned = [...cfg.banned].join(', ');
    return [
      `enabled: ${cfg.enabled}`,
      `cooldownTurns: ${cfg.cooldownTurns}`,
      `entryCharLimit: ${cfg.entryCharLimit}`,
      `memoryAutoUpdate: ${cfg.memoryAutoUpdate}`,
      `memoryCharLimit: ${cfg.memoryCharLimit}`,
      `ignoreAllCaps: ${cfg.ignoreAllCaps}`,
      `lookback: ${cfg.lookback}`,
      `useBullets: ${cfg.useBullets}`,
      `scanBlockLimit: ${cfg.scanBlockLimit}`,
      `candidatesCap: ${cfg.candidatesCap}`,
      `defaultType: ${cfg.defaultType}`,
      `enableCardScripts: ${cfg.enableCardScripts}`,
      `characterPronouns: ${cfg.characterPronouns}`,
      `relationshipWords: ${cfg.relationshipWords}`,
      `conjunctionGuard: ${cfg.conjunctionGuard}`,
      `triggerEnable: ${cfg.triggerEnable}`,
      `triggerTTL: ${cfg.triggerTTL}`,
      `triggerMaxPerTurn: ${cfg.triggerMaxPerTurn}`,
      `triggerCaseInsensitive: ${cfg.triggerCaseInsensitive}`,
      `triggerAnchor: ${cfg.triggerAnchor}`,
      `bannedTitles: ${banned}`,
      ``,
      `# Supported keys: enabled, cooldownTurns, entryCharLimit, memoryAutoUpdate, memoryCharLimit, ignoreAllCaps, lookback, useBullets, scanBlockLimit, candidatesCap, defaultType, enableCardScripts, characterPronouns, relationshipWords, conjunctionGuard, triggerEnable, triggerTTL, triggerMaxPerTurn, triggerCaseInsensitive, triggerAnchor, bannedTitles`
    ].join('\\n');
  }

  /**
 * Parse key: value lines from a card description.
 * @param {string} text
 * @returns {Object<string,string>}
 * ROBUSTNESS: Ignores blank lines and comments starting with '#'.
 */


  function parseConfigText(text){
    const out = {};
    const lines = String(text||'').split(/\\r?\\n/);
    for (let line of lines){
      line = line.trim(); if (!line || line.startsWith('#')) continue;
      const m = line.match(/^([a-zA-Z][a-zA-Z0-9_]*)\\s*:\\s*(.*)$/);
      if (!m) continue;
      const key=m[1];
      let val=m[2].trim();
      out[key] = val;
    }
    return out;
  }

  /**
 * Apply a single config key/value pair to CFG.
 * @param {string} key
 * @param {string} raw
 * @returns {void}
 * SAFETY: Unknown keys are ignored; types are validated/coerced.
 */


  function applyConfigKV(key, raw){
    const v = (raw||'').trim();
    switch(key){
      case 'enabled': CFG.enabled = /^(true|1|yes|on)$/i.test(v); break;
      case 'cooldownTurns': CFG.cooldownTurns = toInt(v, CFG.cooldownTurns); break;
      case 'entryCharLimit': CFG.entryCharLimit = toInt(v, CFG.entryCharLimit); break;
      case 'memoryAutoUpdate': CFG.memoryAutoUpdate = /^(true|1|yes|on)$/i.test(v); break;
      case 'memoryCharLimit': CFG.memoryCharLimit = toInt(v, CFG.memoryCharLimit); break;
      case 'ignoreAllCaps': CFG.ignoreAllCaps = /^(true|1|yes|on)$/i.test(v); break;
      case 'lookback': CFG.lookback = toInt(v, CFG.lookback); break;
      case 'useBullets': CFG.useBullets = /^(true|1|yes|on)$/i.test(v); break;
      case 'scanBlockLimit': CFG.scanBlockLimit = toInt(v, CFG.scanBlockLimit); break;
      case 'candidatesCap': CFG.candidatesCap = toInt(v, CFG.candidatesCap); break;
      case 'defaultType': CFG.defaultType = v || CFG.defaultType; break;
      case 'enableCardScripts': CFG.enableCardScripts = /^(true|1|yes|on)$/i.test(v); break;
      case 'characterPronouns': CFG.characterPronouns = v || CFG.characterPronouns; break;
      case 'relationshipWords': CFG.relationshipWords = v || CFG.relationshipWords; break;
      case 'conjunctionGuard': CFG.conjunctionGuard = /^(true|1|yes|on)$/i.test(v); break;
      case 'bannedTitles': CFG.banned = new Set(v.split(',').map(s=>sanitizeTitle(s)).filter(Boolean)); break;
      case 'triggerEnable': CFG.triggerEnable = /^(true|1|yes|on)$/i.test(v); break;
      case 'triggerTTL': CFG.triggerTTL = toInt(v, CFG.triggerTTL); break;
      case 'triggerMaxPerTurn': CFG.triggerMaxPerTurn = toInt(v, CFG.triggerMaxPerTurn); break;
      case 'triggerCaseInsensitive': CFG.triggerCaseInsensitive = /^(true|1|yes|on)$/i.test(v); break;
      case 'triggerAnchor': CFG.triggerAnchor = v || CFG.triggerAnchor; break;
      default: break;
    }
  }

  /**
 * Parse a possibly-messy numeric string.
 * @param {string} s
 * @param {number} d - default value
 * @returns {number}
 */


  function toInt(s, d){
    const n = parseInt(String(s).replace(/[^0-9\\-]/g,''), 10);
    return Number.isFinite(n)? n : d;
  }

  // ==================
  //  CARD MANAGEMENT
  // ==================
  /**
 * Gather all current card titles.
 * @returns {string[]}
 */

  function getUsedTitles(){
    return _cards.map(c=> c&&c.title? String(c.title):"").filter(Boolean);
  }
  /**
 * Find a card index by normalized title.
 * @param {string} title
 * @returns {number} - index or -1
 * NORMALIZATION: Case-insensitive and punctuation-insensitive.
 */

  function findCardIndex(title){
    const key=normTitle(title);
    for(let i=0;i<_cards.length;i++){
      const t=_cards[i]&&_cards[i].title? normTitle(_cards[i].title):"";
      if(t && t===key) return i;
    }
    return -1;
  }
  /**
 * Create a new story card with a temporary handle, then retitle.
 * @param {string} title
 * @param {string} [forcedType]
 * @returns {number} - Card index or -1
 * UX: Seeds entry with a plain label; generator will flesh it out.
 */

  function createCard(title, forcedType){
    const tmp = "%@%"+Math.random().toString(36).slice(2);
    _add(tmp);
    let idx=-1;
    for(let i=0;i<_cards.length;i++){ if(_cards[i]&&_cards[i].title===tmp){ idx=i; break; } }
    if(idx<0) return -1;
    const card=_cards[idx];
    card.type = forcedType || CFG.defaultType;
    card.title=title;
    card.keys=title.replace(/[^A-Za-z0-9 ]/g," ").replace(/\\s+/g,",");
    card.entry=`{title: ${title}}`;
    card.description="";
    return idx;
  }

  // ==================
  //  MEMORY HELPERS
  // ==================
  /**
 * Make a tiny stable-ish hex hash for memory IDs.
 * @param {string} s
 * @returns {string} - six hex chars
 * NOTE: Not cryptographically secure; it's a friendly label generator.
 */

  function hash6(s){
    let h=0;
    for (let i=0;i<s.length;i++){ h=((h<<5)-h + s.charCodeAt(i))|0; }
    return (h>>>0).toString(16).slice(0,6);
  }
  /**
 * Prefix a content hash with '#' to form an id token.
 * @param {string} text
 * @returns {string} - '#xxxxxx'
 */

  function ensureIdForLine(text){ return "#"+hash6(text); }

  SmartCards.API = SmartCards.API || {};
  SmartCards.API.addMemory = function(targetTitle, raw){
    const idx = findCardIndex(targetTitle); if (idx<0) return false;
    const card=_cards[idx];
    const t = String(raw||"").trim(); if(!t) return false;
    const id=ensureIdForLine(t);
    const turn=TURN();
    if (String(card.description||"").includes(`[${id}]`)) return false;
    const line = `[T${turn}][${id}] - `+t;
    card.description = clip((card.description?card.description+"\\n":"") + line, CFG.memoryCharLimit*2);
    if (card.description.length > CFG.memoryCharLimit && CFG.memoryAutoUpdate){
      scheduleCompress(targetTitle, idx, card.description);
    }
    return true;
  }

  // =============
  //  UTILITIES
  // =============
  /**
 * Normalize text to NFKC (Not KFC) and strip control/invisible chars.
 * @param {string} s
 * @returns {string}
 * WHY: Keeps regexes sane and reproducible.
 */

  function normalize(s){
    try{s=String(s||"").normalize('NFKC');}catch(_){s=String(s||"");}
    return s
      .replace(/[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\uFEFF]/g,'')
      .replace(/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]/g,'');
  }
  /**
 * Sanitize a title by trimming quotes/brackets and condensing whitespace.
 * @param {string} t
 * @returns {string}
 */

  function sanitizeTitle(t){
    t = normalize(t)
      .replace(/^\\s+|\\s+$/g,'')
      .replace(/^[\\'\"“”‘’`{\\[]+|[\\'\"“”‘’`}\\]]+$/g, '')
      .replace(/[\\s\\-–—_]+/g,' ')
      .replace(/\\s+/g,' ')
      .trim();
    return t;
  }
  /**
 * Gentle sanitizer (Non-alcoholic) for focus/first lines; preserves inner punctuation.
 * @param {string} t
 * @returns {string}
 */

  function sanitizeSoft(t){
    return normalize(t)
      .replace(/[\\n\\r]+/g,' ')
      .replace(/^[\\'\"“”‘’`{\\[]+|[\\'\"“”‘’`}\\]]+$/g, '')
      .trim();
  }
  /**
 * Normalize a title for identity checks (case/punct insensitive).
 * @param {string} t
 * @returns {string}
 */

  function normTitle(t){
    return sanitizeTitle(t).toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\\s+/g,' ').trim();
  }
  /**
 * Quick stopword/structure filter for extracted titles.
 * @param {string} s
 * @returns {boolean} - true if we should skip
 */

  function commonStop(s){
    const lw=s.toLowerCase();
    return ["you","the","a","an"].includes(lw) || /^(chapter|act|scene|page)\\b/i.test(s) || /\\d/.test(s);
  }
  /**
 * Coarse filter for junk titles, all-caps (if configured), or too-short.
 * @param {string} c
 * @returns {boolean}
 */

  function skipTitle(c){
    if(!c||c.length<2) return true;
    if (CFG.ignoreAllCaps && c===c.toUpperCase()) return true;
    if (commonStop(c)) return true;
    return false;
  }
  /**
 * Strip trailing numbers (e.g., 'Act 3' -> 'Act').
 * @param {string} s
 * @returns {string}
 */

  function denumber(s){ return s.replace(/\\s*\\d+$/,''); }

  /**
 * Extract only the model content after our end marker, if present.
 * @param {string} s
 * @returns {string|null}
 * WHY: Some models echo prompts; this trims the wrapper politely.
 */


  function extractAfterMarker(s) {
    const modern = />{3}\\s*SmartCards\\s*:.*?<<?\\s*end\\s*SmartCards\\s*<<?\\s*([\\s\\S]*)/i.exec(s);
    if (modern) return modern[1].trim();
    return null;
  }

  /**
 * Clip text to n chars, trimming rightmost whitespace, append ellipsis if needed.
 * @param {string} s
 * @param {number} n
 * @returns {string}
 */


  function clip(s,n){ s=String(s||"").replace(/\\s+$/,''); return s.length<=n? s : (s.slice(0,Math.max(0,n-1)).trimEnd()+"…"); }
  /**
 * Format an entry to bullets if configured; leaves as-is if already bulleted.
 * @param {string} text
 * @returns {string}
 */

  function formatEntry(text){
    const t=String(text||"").trim(); if(!t) return "";
    if(CFG.useBullets && !/^\\s*[-•]/.test(t)) return "- "+t.replace(/\\n+/g,"\\n- ");
    return t;
  }
  /**
 * Parse a JSON block and pull a sanitized list of #ids to keep.
 * @param {string} s
 * @returns {string[]} - normalized '#xxxxxx' ids
 * RESILIENCE: Returns [] on any parse error.
 */

  function parseKeepIds(s){
    try{
      const m=s.match(/\\{[\\s\\S]*\\}/);
      if(!m) return [];
      const j=JSON.parse(m[0]);
      const arr=Array.isArray(j.keep)? j.keep: [];
      return arr
        .map(x=>String(x||"").replace(/^#+/,'#'))
        .filter(x=>/^#?[a-f0-9]{6}$/i.test(x.replace('#','')))
        .map(x=> x.startsWith('#')? x: '#'+x);
    } catch(_){ return []; }
  }

  /**
 * Is a title banned by exact or first-word match.
 * @param {string} t
 * @returns {boolean}
 * TIP: Useful for weekdays/months/directions that look like names.
 */


  function isBanned(t){
    if(!t) return true;
    const lower = new Set(Array.from(CFG.banned || []).map(x=>String(x).toLowerCase()));
    const tl = String(t).toLowerCase().trim();
    if (lower.has(tl)) return true;
    const f = tl.split(' ')[0];
    return lower.has(f);
  }

  // Standardize return shape back to the host per hook.
  /**
 * Return data to the host in the expected shape per hook.
 * @param {string} h - hook
 * @param {string} t - text
 * @param {boolean} s - stop
 * @returns {string|[string, boolean]}
 * SIDE EFFECT: Persists CFG back to state for the next turn.
 */

  function finalize(h,t,s){
    _state.ACM.config=CFG;
    switch(h){
      case 'context': return [t, s===true];
      default: return t;
    }
  }
}

// ==============================
//  CONFIG MERGE (shallow‑smart)
// ==============================
/**
 * Shallow-smart merge of config objects with Set handling for 'banned'.
 * @param {object} base
 * @param {object} given
 * @returns {object} - merged config
 * WHY: Durable across reloads; safe defaulting for nested simple objects.
 */

function mergeCfg(base, given){
  const out=JSON.parse(JSON.stringify(base));
  if (base.banned instanceof Set) out.banned = new Set(base.banned);
  for (const k in given){
    if (k==='banned' && given[k] instanceof Set){
      out[k]=new Set([...base.banned, ...given[k]]);
    } else if (typeof given[k]==='object' && given[k] && !Array.isArray(given[k])) {
      out[k]=Object.assign({}, base[k], given[k]);
    } else {
      out[k]=given[k];
    }
  }
  return out;
/** 
 * ——— End of SmartCards ———
 * Or is it? I AM THE HERALD OF HIS COMING!
 */

}
