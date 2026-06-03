export function chatVisibilityFrom(message) {
  return {
    whisper: [...(message?.whisper ?? [])],
    blind: !!message?.blind,
  };
}

export function applyChatVisibility(data, visibility) {
  if (!visibility) return data;
  data.whisper = [...(visibility.whisper ?? [])];
  data.blind = !!visibility.blind;
  return data;
}
