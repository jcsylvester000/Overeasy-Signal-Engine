import { describe, expect, it } from "vitest";
import { inspectHtml } from "../install-check";

describe("install check", () => {
  it("finds the tag with the right key", () => {
    expect(inspectHtml(`<head><script async src="https://t.a.com/ose.js" data-site="site_abc"></script></head>`, "site_abc").status).toBe("found");
  });
  it("flags a different site key", () => {
    expect(inspectHtml(`<script src="/ose.js" data-site="site_other"></script>`, "site_abc").status).toBe("wrong_key");
  });
  it("recognises Tag Manager installs", () => {
    expect(inspectHtml(`<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC123"></script>`, "site_abc").status).toBe("via_tag_manager");
  });
  it("reports missing tag", () => {
    expect(inspectHtml(`<html><head></head></html>`, "site_abc").status).toBe("not_found");
  });
});
