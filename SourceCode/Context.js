// CONTEXT MODIFIER
// Lets SmartCards inject its system prompt and manage pending ops.
// Must return { text, stop } for AI Dungeon.
const modifier = (text) => {
  try {
    if (typeof SmartCards !== "function") return { text, stop: false };

    // The library is designed to be called like:
    // [text, stop] = SmartCards("context", text, stop);
    let stop = false;
    const out = SmartCards("context", text, stop);

    // SmartCards returns [text, stop] for 'context'
    if (Array.isArray(out)) {
      return { text: String(out[0] ?? text), stop: !!out[1] };
    }

    // Defensive fallback (shouldn't happen)
    return { text: String(out ?? text), stop: false };
  } catch (e) {
    try { state.message = "SmartCards (context) error: " + String(e.message || e); } catch(_) {}
    return { text, stop: false };
  }
};
