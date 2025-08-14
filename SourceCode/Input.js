// INPUT MODIFIER
// Purpose: Route /ac and /sc commands to SmartCards.
// Guarantees that a failure never blocks play; errors are surfaced via state.message.

const modifier = (text) => {
  try {
    if (typeof SmartCards !== "function") return text;
    // Drop‑in as designed by the library:
    // text = SmartCards("input", text);
    return SmartCards("input", text);
  } catch (e) {
    // Fail safe: never block play if something throws.
    try { state.message = "SmartCards (input) error: " + String(e.message || e); } catch(_) {}
    return text;
  }
};
