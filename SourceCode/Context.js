// CONTEXT MODIFIER
// Purpose: Let SmartCards inject a short system prompt when a job is pending
// and optionally signal the host to stop generation early (`stop = true`)
// after injecting. Must return { text, stop } for AI Dungeon.

const modifier = (text) => {
  try {
    if (typeof SmartCards !== "function") return { text, stop: false };

    // The library is designed to be called like:
    // [text, stop] = SmartCards("context", text, stop);
    let stop = false;
    const out = SmartCards("context", text, stop);

    // SmartCards returns [text, stop] for 'context'
    if (Array.isArray(out)) {
return { text: String((out[0] !== null && out[0] !== undefined) ? out[0] : text), stop: !!out[1] };
    }

    // Defensive fallback (shouldn't happen)
    return { text: String((out !== undefined && out !== null) ? out : text), stop: false };
  } catch (e) {
    try { state.message = "SmartCards (context) error: " + String(e.message || e); } catch(_) {}
    return { text, stop: false };
  }
};
