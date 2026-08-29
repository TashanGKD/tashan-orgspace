import type { SearchProvider } from "./provider.js";

export class OrganizationSearchProvider implements SearchProvider {
  public async authorize() {
    return true;
  }
}
