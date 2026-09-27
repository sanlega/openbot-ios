export function createLiveViewUrl(novncPort: number, token: string): string {
  const url = new URL(`http://127.0.0.1:${novncPort}/vnc.html`);
  url.searchParams.set("autoconnect", "1");
  url.searchParams.set("path", `websockify?token=${token}`);
  url.searchParams.set("resize", "scale");
  url.searchParams.set("quality", "9");
  return url.toString();
}
