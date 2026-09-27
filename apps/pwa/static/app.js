const DB_NAME = "openbot-pwa";
const STORE = "device";

/** @typedef {{ token: string; deviceId: string; framingKey: string; serverHeader: string; baseUrl: string; devicePub: string; devicePriv: string; }} StoredDevice */

async function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** @returns {Promise<StoredDevice | undefined>} */
async function loadDevice() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const get = tx.objectStore(STORE).get("current");
    get.onsuccess = () => resolve(get.result);
    get.onerror = () => reject(get.error);
  });
}

/** @param {StoredDevice} value */
async function saveDevice(value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, "current");
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
}

async function clearDevice() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete("current");
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
}

function parsePairFragment() {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  if (!hash.startsWith("pair=")) return undefined;
  const encoded = hash.slice("pair=".length);
  return JSON.parse(decodeURIComponent(encoded));
}

async function generateDeviceKeyPair() {
  const keyPair = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveKey", "deriveBits"]);
  const publicKey = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  return {
    devicePub: btoa(String.fromCharCode(...new Uint8Array(publicKey))),
    devicePriv: btoa(String.fromCharCode(...new Uint8Array(privateKey))),
    keyPair,
  };
}

async function deriveFramingKey(devicePrivB64, hostPubB64) {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(devicePrivB64), (c) => c.charCodeAt(0)),
    { name: "X25519" },
    false,
    ["deriveBits"],
  );
  const hostKey = await crypto.subtle.importKey(
    "spki",
    Uint8Array.from(atob(hostPubB64), (c) => c.charCodeAt(0)),
    { name: "X25519" },
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits({ name: "X25519", public: hostKey }, privateKey, 256);
  const prefix = new TextEncoder().encode("openbot-e2e-v1");
  const sharedBuf = new Uint8Array(shared);
  const material = new Uint8Array(prefix.length + sharedBuf.length);
  material.set(prefix);
  material.set(sharedBuf, prefix.length);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

function showPaired(stored) {
  document.getElementById("pair-screen").hidden = true;
  document.getElementById("home-screen").hidden = false;
  document.getElementById("home-status").textContent = `Connected as ${stored.deviceId}`;
}

function showPairing(message, isError = false) {
  const el = document.getElementById("pair-status");
  el.textContent = message;
  el.className = isError ? "status-err" : "muted";
}

async function completePairing(payload) {
  const name = document.getElementById("device-name").value.trim() || "My phone";
  const { devicePub, devicePriv } = await generateDeviceKeyPair();
  const baseUrl = payload.urls?.[0] ?? `${location.origin}`;
  const apiBase = baseUrl.replace(/\/$/, "");
  const response = await fetch(`${apiBase}/api/devices/pair/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pairSecret: payload.pairSecret,
      devicePub,
      name,
      role: "approver",
      via: apiBase.includes("trycloudflare") ? "cloudflare" : apiBase.includes(".ts.net") ? "tailscale" : "lan",
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.reason ?? `pairing failed (${response.status})`);
  }
  const body = await response.json();
  const framingKey = await deriveFramingKey(devicePriv, payload.hostPub);
  /** @type {StoredDevice} */
  const stored = {
    token: body.token,
    deviceId: body.device.id,
    framingKey,
    serverHeader: body.e2e.serverHeader,
    baseUrl: apiBase,
    devicePub,
    devicePriv,
  };
  await saveDevice(stored);
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("/app/sw.js");
  }
  showPaired(stored);
}

async function boot() {
  const stored = await loadDevice();
  if (stored) {
    showPaired(stored);
    return;
  }

  const payload = parsePairFragment();
  if (payload?.pairSecret && payload.hostPub) {
    document.getElementById("pair-button").addEventListener("click", async () => {
      try {
        showPairing("Pairing…");
        await completePairing(payload);
        showPairing("Paired successfully.", false);
      } catch (error) {
        showPairing(error instanceof Error ? error.message : "Pairing failed", true);
      }
    });
    showPairing("QR payload loaded. Tap Complete pairing.");
    return;
  }

  showPairing("Scan the desktop QR code to load pairing data.", false);
}

document.getElementById("revoke-button")?.addEventListener("click", async () => {
  await clearDevice();
  location.reload();
});

boot().catch((error) => showPairing(error instanceof Error ? error.message : "Boot failed", true));
