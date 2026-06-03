export function chatVisibilityFrom(message) {
  return {
    whisper: [...(message?.whisper ?? [])],
    blind: !!message?.blind,
  };
}

/**
 * Apply visibility to outgoing chat data.
 *
 * When `visibility` is provided (a `{ whisper, blind }` snapshot from a
 * triggering roll message), the card mirrors that roll exactly. When it is
 * absent — i.e. the card is not tied to any roll (Empathy learning, training
 * interruption, unmapped-discipline learn, etc.) — fall back to the user's
 * current core roll mode so the card honours Self/GM/Blind roll instead of
 * always posting publicly.
 */
export function applyChatVisibility(data, visibility) {
  if (!visibility) {
    const rollMode = game.settings.get("core", "rollMode");
    return ChatMessage.implementation.applyRollMode(data, rollMode);
  }
  data.whisper = [...(visibility.whisper ?? [])];
  data.blind = !!visibility.blind;
  return data;
}
