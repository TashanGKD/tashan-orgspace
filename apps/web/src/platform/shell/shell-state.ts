const sidebarStorageKey = "orgspace.sidebar-collapsed";

export function readSidebarCollapsed(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  return storage.getItem(sidebarStorageKey) === "1";
}

export function writeSidebarCollapsed(
  collapsed: boolean,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(sidebarStorageKey, collapsed ? "1" : "0");
}
