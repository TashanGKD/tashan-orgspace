import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App, type WebDeviceMetadata } from "./app.js";
import { createWebClient } from "./api.js";
import "./styles.css";

const deviceStorageKey = "torg.web.device-id";
const storedDeviceId = localStorage.getItem(deviceStorageKey);
const deviceId = storedDeviceId ?? crypto.randomUUID();
if (storedDeviceId === null) localStorage.setItem(deviceStorageKey, deviceId);

const device: WebDeviceMetadata = {
  id: deviceId,
  name: navigator.platform || "Web browser",
  os: navigator.platform || "web",
  architecture: "browser",
  clientVersion: "0.0.0",
  channel: "web",
};
const apiUrl = import.meta.env.VITE_TORG_API_URL ?? "http://127.0.0.1:4110";
const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) throw new Error("root element is missing");

createRoot(root).render(
  <StrictMode>
    <App sdk={createWebClient(apiUrl, deviceId)} device={device} />
  </StrictMode>,
);
