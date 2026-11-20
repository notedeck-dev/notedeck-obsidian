/**
 * API URL がこの端末 (127.0.0.1 / localhost / [::1]) の http(s) を指しているか。
 * token は NoteDeck の全アカウントに届く鍵なので、他のホストには送らない
 */
export function isLoopbackUrl(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  );
}

export const NOT_LOOPBACK_MESSAGE =
  "The API URL must point at this machine (127.0.0.1, localhost or [::1]). Nothing was sent.";
