// The chat workspace namespace shared by the chat app's modules (kept on window.CW for compatibility).
// CW.pages holds the secondary screens (pages/*.js register themselves on it).
export const CW = window.CW = window.CW || {};
CW.pages = CW.pages || {};
