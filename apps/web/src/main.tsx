import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

import { DeviceLoginMetadata } from "@tashan/contracts";

import { App } from "./app.js";
import { createWebClient, resolveWebApiOrigin } from "./api.js";
import "./styles.css";

const deviceStorageKey = "torg.web.device-id";
const storedDeviceId = localStorage.getItem(deviceStorageKey);
const deviceId = storedDeviceId ?? crypto.randomUUID();
if (storedDeviceId === null) localStorage.setItem(deviceStorageKey, deviceId);

const device = DeviceLoginMetadata.parse({
  id: deviceId,
  name: navigator.platform || "Web browser",
  os: navigator.platform || "web",
  architecture: "browser",
  clientVersion: "0.0.0",
  channel: "web",
});
const apiUrl = resolveWebApiOrigin({ origin: window.location.origin });
const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) throw new Error("root element is missing");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App sdk={createWebClient(apiUrl, deviceId)} device={device} />
    </BrowserRouter>
  </StrictMode>,
);
