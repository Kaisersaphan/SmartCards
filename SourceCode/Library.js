/*
 * SmartCards
 * Copyright (c) 2025 KaiserSaphan
 * Licensed under Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International
 */

/*
SmartCards— v0.8
Author: KaiserSaphan, & Micah (refactor), inspired by AutoCards (LewdLeah)

Drop-in hooks (unchanged):
  text = SmartCards("input", text);
  [text, stop] = SmartCards("context", text, stop);
  text = SmartCards("output", text);
*/
function SmartCards(hook, inText, inStop) {
  "use strict";
  // ===== Env guards / polyfills =====
  const _g = (typeof global !== 'undefined') ? global : (typeof window !== 'undefined' ? window : {});
  const _state = (typeof state !== 'undefined') ? state : (_g.__SC_STATE__ ||= {});
  const _info  = (typeof info  !== 'undefined') ? info  : { actionCount: 0 };
  const _hist  = (typeof history !== 'undefined') ? history : [];
  const _cards = (typeof storyCards !== 'undefined') ? storyCards : (_g.__SC_CARDS__ ||= []);
  const _add   = (typeof addStoryCard === 'function') ? addStoryCard : (t)=>{ _cards.push({ title:t, type:'class', keys:'', entry:'', description:'' }); };
  const TURN   = ()=> (Number.isInteger(_info.actionCount)? _info.actionCount : (_hist? _hist.length:0))|0;

  const CONFIG_CARD_TITLE = "SmartCards Config";

  // ===== Config =====
  const DEFAULT_CFG = {
    enabled: true,
    // Normal
    cooldownTurns: 18,          // auto-generation spacing; NO effect on manual /ac
    entryCharLimit: 650,
    memoryAutoUpdate: true,
    memoryCharLimit: 2200,
    ignoreAllCaps: true,
    lookback: 6,
    useBullets: true,
    scanBlockLimit: 4000,
    candidatesCap: 100,
    defaultType: "class",
    // NEW: heuristics for character typing
    characterPronouns: "he, him, his, she, her, hers, they, them, their, theirs",
    relationshipWords: "father, mother, dad, mum, mom, son, daughter, sister, brother, husband, wife, spouse, partner, fiancée, fiancé, friend, buddy, mate, pal, rival, enemy, mentor, mentee, boss, chief, leader, captain, teacher, coach, boyfriend, girlfriend, ex",
    conjunctionGuard: true,
    // Per-adventure scripts
    enableCardScripts: true,    // allow "AC Script:" cards to run code
    // Prompts
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
      "Schema: {\"keep\":[\"#id\", ...]}",
      "Rules: Do NOT invent ids. Prefer recent (higher T) and non-duplicates. If in doubt, omit.",
      "</SYSTEM>",
      "BULLETS:",
      "%{memory}",
      "JSON only:"
    ].join("\n"),
    banned:new Set("North,East,South,West,Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,January,February,March,April,May,June,July,August,September,October,November,December".split(","))
  };

  _state.ACM ??= { config: DEFAULT_CFG, lastAutoTurn:-999, candidates:[], pending:null, lastAppliedTitle:null };
  const S = _state.ACM; const CFG = S.config = mergeCfg(DEFAULT_CFG, S.config||{});

  const TEXT = typeof inText === 'string' ? normalize(inText) : "\n";
  const STOP = inStop === true;
  if (!CFG.enabled) return finalize(hook, TEXT, STOP);

  try {
    switch(hook){
      case 'input':{
        const t = TEXT.trim();
        runCardScripts("beforeCommand", { raw: t, turn: TURN() });

        // Rich: /ac Title / Focus? / FirstLine?  (brace/quote tolerant)
        const rich = t.match(/^\s*\/(?:ac|sc)\s+(.+?)(?:\s*\/\s*(.*?))?(?:\s*\/\s*(.*?))?\s*$/i);
        if (rich){
          const title = sanitizeTitle(rich[1]||'');
          const focus = sanitizeSoft(rich[2]||'');
          const first = sanitizeSoft(rich[3]||'');
          if (title) scheduleGenerate(title,{focus,first});
          runCardScripts("afterCommand", { type:"ac", mode:"create", title, focus, first, turn: TURN() });
          return finalize(hook, "\n", STOP); // swallow so AID core parser doesn't see it
        }

        // Legacy toggles (all except /ac gen)
        if (/^\s*\/(?:ac|sc)\b/i.test(t)){
          const mOn   = t.match(/\bon\b/i);
          const mOff  = t.match(/\boff\b/i);
          const mRedo = t.match(/\bredo\s+"?([^"]+)"?/i);
          const mBan  = t.match(/\bban\s+"?([^"]+)"?/i);
          const mCfg  = t.match(/\bconfig\b/i) || t.match(/\bconfid\b/i);

          if (mOn)  { CFG.enabled = true;  _state.message = "SmartCards: enabled."; }
          if (mOff) { CFG.enabled = false; _state.message = "SmartCards: disabled."; }
          if (mRedo){ const title = sanitizeTitle(mRedo[1]); scheduleGenerate(title,{redo:true}); }
          if (mBan) { CFG.banned.add(sanitizeTitle(mBan[1])); _state.message = "SmartCards: title banned."; }
          if (mCfg) { writeConfigCard(true); _state.message = "SmartCards: Config card created/updated."; }

          runCardScripts("afterCommand", { type:"ac", mode:"legacy", raw: t, turn: TURN() });
          return finalize(hook, "\n", STOP);
        }

        return finalize(hook, TEXT, STOP);
      }

      case 'context':{
        runCardScripts("turnStart", { turn: TURN() });
        runCardScripts("beforeContext", { text: TEXT, turn: TURN() });

        // Apply config edits (if any)
        readConfigCard();

        // Prepare candidates for auto mode
        if (!S.pending) scanForCandidates();

        if (S.pending){
          const msg = buildSystemMessage(S.pending);
          const updated = injectMessage(TEXT, msg); // append-only
          runCardScripts("afterContext", { text: updated, turn: TURN() });
          return finalize(hook, updated, STOP);
        } else {
          runCardScripts("afterContext", { text: TEXT, turn: TURN() });
          return finalize(hook, TEXT, STOP);
        }
      }

      case 'output':{
        if (S.pending){
          try{
            applyPending(TEXT);
          } catch(e){
            _state.message = `SmartCards: apply failed (${String(e.message||e)})`;
          } finally { S.pending=null; }
        } else {
          const turn = TURN();
          if (turn - S.lastAutoTurn >= CFG.cooldownTurns){
            const t = nextCandidate();
            if (t){ scheduleGenerate(t); S.lastAutoTurn = turn; _state.message = `SmartCards: preparing \"${t}\" card... press Continue.`; }
          }
        }
        runCardScripts("turnEnd", { turn: TURN() });
        return finalize(hook, TEXT, STOP);
      }

      default: return finalize(hook, TEXT, STOP);
    }
  } catch(err){ _state.message = `SmartCards: ${String(err && err.message || err)}`; return finalize(hook, TEXT, STOP); }

  // ===== Implementation =====

// --- Character typing helpers (pronouns/relationships/conjunction guard) ---
function _csvToSet(s) {
  const out = new Set();
  String(s || "").split(",").forEach(x => {
    const t = x.trim().toLowerCase();
    if (t) out.add(t);
  });
  return out;
}
function hasConjunction(title) {
  const t = String(title || "").toLowerCase();
  return /\band\b|&/.test(t);
}
function hasPronoun(text, cfg) {
  const set = _csvToSet(cfg.characterPronouns);
  const words = String(text || "").toLowerCase().match(/[a-z']+/g) || [];
  for (const w of words) if (set.has(w)) return true;
  return false;
}
function hasRelationshipWord(text, cfg) {
  const set = _csvToSet(cfg.relationshipWords);
  const words = String(text || "").toLowerCase().match(/[a-z’']+/g) || [];
  for (const w of words) if (set.has(w)) return true;
  return false;
}
function sentenceContaining(title, text) {
  const t = String(text || "");
  const pieces = t.split(/(?<=[\.\?\!])\s+/);
  const rx = new RegExp("\\b" + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\b");
  for (const s of pieces) {
    if (rx.test(s)) return s;
  }
  return "";
}
  function scanForCandidates(){
    const start = Math.max(0, _hist.length - (CFG.lookback|0));
    const used = new Set(getUsedTitles().map(normTitle));
    for (let i=start;i<_hist.length;i++){
      const h=_hist[i]; const block = (h&&typeof h.text==='string')? normalize(h.text).slice(0,CFG.scanBlockLimit):"";
      if (!block) continue; const found = extractTitles(block);
      for (const t of found){ const k=normTitle(t); if (!k||used.has(k)||isBanned(t)) continue; S.candidates.push({title:t, turn:i, sourceText:block}); }
    }
    // de-dup + cap
    const seen=new Set();
    S.candidates = S.candidates.filter(c=>{const k=normTitle(c.title); if(seen.has(k)) return false; seen.add(k); return true;});
    if (S.candidates.length>CFG.candidatesCap) S.candidates.splice(0,S.candidates.length-CFG.candidatesCap);
  }

  function extractTitles(block){
    const out=new Set(); const clean=block.replace(/[{}<>\[\]]/g," ").replace(/\s+/g," ");
    let re=/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g, m; // up to 4 words
    while((m=re.exec(clean))){ const c=sanitizeTitle(m[1]); if(skipTitle(c)) continue; out.add(denumber(c)); }
    let re1=/\b([A-Z][a-z]{3,})\b/g, k; // single names
    while((k=re1.exec(clean))){ const c=sanitizeTitle(k[1]); if(skipTitle(c)) continue; out.add(c); }
    return [...out].slice(0,24);
  }

  
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


  function scheduleGenerate(title, opts={}){
    if (S.pending) return;
    const idx = findCardIndex(title); const card = idx>=0? _cards[idx]: null;

    // Seed entry
    let entrySeed = card? String(card.entry||"") : (CFG.useBullets? "- " : "");
    if (opts.first){ entrySeed = (CFG.useBullets? "- ":"") + opts.first.trim(); }

    // Allow scripts to tweak before prompt is built
    runCardScripts("beforeGenerate", { title, entrySeed, card });

    const prompt = CFG.generationPrompt
      .replace(/%\{title\}/g,title)
      .replace(/%\{focus\}/g, String(opts.focus||''))
      .replace(/%\{entry\}/g, entrySeed);

    S.pending = { mode:"generate", title, cardIndex: idx, payload:{ prompt, entrySeed, desiredType: (opts && opts.desiredType) ? opts.desiredType : null } };
  }

  function scheduleCompress(title, idx, memoryText){
    if (S.pending) return;
    const safeMem = clip(String(memoryText||""), CFG.memoryCharLimit*2);
    const prompt = CFG.compressionPrompt.replace(/%\{memory\}/g, safeMem);
    S.pending = { mode:"compress", title, cardIndex: idx, payload:{ prompt, sourceMemory: safeMem } };
  }

  function buildSystemMessage(p){
    const prompt = clip(p.payload.prompt, 3200);
    return ">>> SmartCards: system prompt >>>\n"+prompt+"\n<<< end SmartCards <<<";
  }

  function injectMessage(ctx, msg){
    // ALWAYS append — never splice near the scenario intro
    return ctx + "\n\n" + msg + "\n\n";
  }

  function applyPending(modelText){
    const p=S.pending; if(!p) return; const title=p.title; S.lastAppliedTitle=title;
    const desiredType = p.payload && p.payload.desiredType;
    const idx = (p.cardIndex>=0)? p.cardIndex : createCard(title, desiredType);
    if (idx<0||!_cards[idx]) return; const card=_cards[idx];
    if (desiredType && String(card.type||"").toLowerCase() === String(CFG.defaultType||"").toLowerCase()) { card.type = desiredType; }
    const payload = String(modelText||""); const segment = extractAfterMarker(payload) || payload;

    if (p.mode === 'generate'){
      let clean = clip(normalize(segment), CFG.entryCharLimit);
      // Allow post-process
      const payloadObj = { title, entry: clean, card };
      runCardScripts("afterGenerate", payloadObj);
      clean = String(payloadObj.entry||clean);

      card.entry = formatEntry(clean, title);
      if (!/SmartCards\s*Mini\s*Memories\s*:/i.test(String(card.description||""))) card.description = `SmartCards Mini Memories:\n`;
      if (CFG.memoryAutoUpdate && String(card.description||"").length > CFG.memoryCharLimit){
        scheduleCompress(title, idx, card.description);
      }
    }
    else if (p.mode === 'compress'){
      const ids = parseKeepIds(segment);
      const lines = String(p.payload.sourceMemory||"").split("\n");
      runCardScripts("beforeCompress", { title, memory: lines.slice(), card });
      const keep = [];
      if (ids.length){ for (const id of ids){ const line = lines.find(b=>b.includes(`[${id}]`)); if(line) keep.push(line); } }
      const finalLines = keep.length? keep : lines.slice(-20);
      runCardScripts("afterCompress", { title, keptLines: finalLines.slice(), card });
      card.description = finalLines.join("\n");
    }
  }

  // ===== Per-adventure script runner (AC Script: <name>) =====
  function eachScriptCard(fn){
    for (let i=0;i<_cards.length;i++){
      const c=_cards[i]; if (!c || !c.title) continue;
      if (/^AC\s*Script\s*:/i.test(String(c.title))) fn(c, i);
    }
  }
  function extractScriptFromCard(card){
    const d = String(card.description||"");
    const m = d.match(/```js([\s\S]*?)```/i);
    return (m ? m[1] : d).trim();
  }
  function apiForScripts(card){
    return {
      addMemory: (title,line)=>SmartCards.API.addMemory(title, line),
      message: (s)=>{ _state.message = String(s||""); },
      log: (...a)=>{ try{ console.log("[AC-Script]", ...a); }catch(_){}; },
      config: CFG,
      findCardIndex,
      renameCard: (idx, title)=>{ if (_cards[idx]) _cards[idx].title = String(title||""); },
      turn: TURN(),
      card, // direct access to this script card (title, entry, description)
    };
  }
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

  // ===== Config card read/write =====
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
`bannedTitles: ${banned}`,
      ``,
      `# Supported keys: enabled, cooldownTurns, entryCharLimit, memoryAutoUpdate, memoryCharLimit, ignoreAllCaps, lookback, useBullets, scanBlockLimit, candidatesCap, defaultType, enableCardScripts, characterPronouns, relationshipWords, conjunctionGuard, bannedTitles
    ].join('\n');
  }

  function parseConfigText(text){
    const out = {};
    const lines = String(text||'').split(/\r?\n/);
    for (let line of lines){
      line = line.trim(); if (!line || line.startsWith('#')) continue;
      const m = line.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
      if (!m) continue; const key=m[1]; let val=m[2].trim();
      out[key] = val;
    }
    return out;
  }

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
      default: break;
    }
  }

  function toInt(s, d){ const n = parseInt(String(s).replace(/[^0-9\-]/g,''), 10); return Number.isFinite(n)? n : d; }

  // ===== Card helpers =====
  function getUsedTitles(){ return _cards.map(c=> c&&c.title? String(c.title):"").filter(Boolean); }
  function findCardIndex(title){ const key=normTitle(title); for(let i=0;i<_cards.length;i++){ const t=_cards[i]&&_cards[i].title? normTitle(_cards[i].title):""; if(t && t===key) return i; } return -1; }
  function createCard(title, forcedType){
    const tmp = "%@%"+Math.random().toString(36).slice(2); _add(tmp);
    let idx=-1; for(let i=0;i<_cards.length;i++){ if(_cards[i]&&_cards[i].title===tmp){ idx=i; break; } }
    if(idx<0) return -1;
    const card=_cards[idx];
    card.type = forcedType || CFG.defaultType;
    card.title=title;
    card.keys=title.replace(/[^A-Za-z0-9 ]/g," ").replace(/\s+/g,",");
    card.entry=`{title: ${title}}`;
    card.description="";
    return idx;
  }

  // ===== Memory helpers (IDs, stamping, adding) =====
  function hash6(s){ let h=0; for (let i=0;i<s.length;i++){ h=((h<<5)-h + s.charCodeAt(i))|0; } return (h>>>0).toString(16).slice(0,6); }
  function ensureIdForLine(text){ return "#"+hash6(text); }

  SmartCards.API = SmartCards.API || {};
  SmartCards.API.addMemory = function(targetTitle, raw){
    const idx = findCardIndex(targetTitle); if (idx<0) return false; const card=_cards[idx];
    const t = String(raw||"").trim(); if(!t) return false; const id=ensureIdForLine(t); const turn=TURN();
    if (String(card.description||"").includes(`[${id}]`)) return false; // dedupe by id
    const line = `[T${turn}][${id}] - `+t;
    card.description = clip((card.description?card.description+"\n":"") + line, CFG.memoryCharLimit*2);
    if (card.description.length > CFG.memoryCharLimit && CFG.memoryAutoUpdate){ scheduleCompress(targetTitle, idx, card.description); }
    return true;
  }

  // ===== Utils =====
  function normalize(s){ try{s=String(s||"").normalize('NFKC');}catch(_){s=String(s||"");} return s.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g,'').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,''); }
  function sanitizeTitle(t){
    t = normalize(t)
      .replace(/^\s+|\s+$/g,'')
      .replace(/^['"“”‘’`{\[]+|['"“”‘’`}\]]+$/g, '') // strip quotes/braces/brackets at ends
      .replace(/[\s\-–—_]+/g,' ')
      .replace(/\s+/g,' ')
      .trim();
    return t;
  }
  function sanitizeSoft(t){
    return normalize(t)
      .replace(/[\n\r]+/g,' ')
      .replace(/^['"“”‘’`{\[]+|['"“”‘’`}\]]+$/g, '')
      .trim();
  }
  function normTitle(t){ return sanitizeTitle(t).toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }
  function commonStop(s){ const lw=s.toLowerCase(); return ["you","the","a","an"].includes(lw) || /^(chapter|act|scene|page)\b/i.test(s) || /\d/.test(s); }
  function skipTitle(c){ if(!c||c.length<2) return true; if (CFG.ignoreAllCaps && c===c.toUpperCase()) return true; if (commonStop(c)) return true; return false; }
  function denumber(s){ return s.replace(/\s*\d+$/,''); }
  function extractAfterMarker(s){ const m=/>{3}\s*SmartCards\s*Mini:.*?<<?\s*end\s*SmartCards\s*Mini\s*<<?\s*([\s\S]*)/i.exec(s); return m? m[1].trim(): null; }
  function clip(s,n){ s=String(s||"").replace(/\s+$/,''); return s.length<=n? s : (s.slice(0,Math.max(0,n-1)).trimEnd()+"…"); }
  function formatEntry(text){ const t=String(text||"").trim(); if(!t) return ""; if(CFG.useBullets && !/^\s*[-•]/.test(t)) return "- "+t.replace(/\n+/g,"\n- "); return t; }
  function parseKeepIds(s){ try{ const m=s.match(/\{[\s\S]*\}/); if(!m) return []; const j=JSON.parse(m[0]); const arr=Array.isArray(j.keep)? j.keep: []; return arr.map(x=>String(x||"").replace(/^#+/,'#')).filter(x=>/^#?[a-f0-9]{6}$/i.test(x.replace('#',''))).map(x=> x.startsWith('#')? x: '#'+x); } catch(_){ return []; } }

  function isBanned(t){ if(!t) return true; if (CFG.banned.has(t)) return true; const f=t.split(' ')[0]; return CFG.banned.has(f); }
  function buildSystemMessage(p){ const prompt=clip(p.payload && p.payload.prompt || "", 3200); return [">>> SmartCards Mini: system prompt >>>", prompt, "<<< end SmartCards Mini <<<"].join("\n"); }
  function finalize(h,t,s){ _state.ACM.config=CFG; switch(h){ case 'context': return [t, s===true]; default: return t; } }
}

function mergeCfg(base, given){ const out=JSON.parse(JSON.stringify(base)); for (const k in given){ if (k==='banned' && given[k] instanceof Set){ out[k]=new Set([...base.banned, ...given[k]]); } else if (typeof given[k]==='object' && given[k] && !Array.isArray(given[k])) out[k]=Object.assign({}, base[k], given[k]); else out[k]=given[k]; } return out; }
