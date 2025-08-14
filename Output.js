// OUTPUT MODIFIER
// Applies pending generations/compressions and schedules the next card.
const modifier = (text) => {
  try {
    if (typeof SmartCards !== "function") return text;
    // Drop‑in as designed by the library:
    // text = SmartCards("output", text);
    return SmartCards("output", text);
  } catch (e) {
    try { state.message = "SmartCards (output) error: " + String(e.message || e); } catch(_) {}
    return text;
  }
};
