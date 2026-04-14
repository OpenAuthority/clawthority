// Tier 10 — unconditional permit rules (low-risk, no HITL required)
// Matches on resource.actionClass attribute injected by CedarEngine.evaluate()

@id("10-filesystem-read")
@tier("10")
@reason("Filesystem read operations are permitted for all agents")
permit (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when { resource has actionClass && resource.actionClass == "filesystem.read" };

@id("10-filesystem-list")
@tier("10")
@reason("Filesystem list operations are permitted for all agents")
permit (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when { resource has actionClass && resource.actionClass == "filesystem.list" };

@id("10-browser-navigate")
@tier("10")
@reason("Browser navigation is permitted for all agents")
permit (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when { resource has actionClass && resource.actionClass == "browser.navigate" };

@id("10-memory-read")
@tier("10")
@reason("Agent memory reads are permitted for all agents")
permit (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when { resource has actionClass && resource.actionClass == "memory.read" };
