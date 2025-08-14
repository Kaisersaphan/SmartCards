// OUTPUT MODIFIER
// Purpose: Consume SmartCards' pending job using the model's last output,
// schedule follow-ups, and never block play on errors.

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
