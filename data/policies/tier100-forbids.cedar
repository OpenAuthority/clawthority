// Tier 100 — unconditional forbid rules (hard deny, no override)
// Defence-in-depth: Cedar forbid wins over any permit for the same request.
// These action classes are blocked regardless of HITL approval state.

@id("100-payment-transfer")
@tier("100")
@reason("Payment transfers require human-in-the-loop approval")
forbid (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when { resource has actionClass && resource.actionClass == "payment.transfer" };

@id("100-payment-initiate")
@tier("100")
@reason("Payment initiation requires human-in-the-loop approval")
forbid (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when { resource has actionClass && resource.actionClass == "payment.initiate" };

@id("100-credential-access")
@tier("100")
@reason("Credential access requires human-in-the-loop approval")
forbid (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when { resource has actionClass && resource.actionClass == "credential.access" };

@id("100-credential-write")
@tier("100")
@reason("Credential write operations require human-in-the-loop approval")
forbid (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when { resource has actionClass && resource.actionClass == "credential.write" };

@id("100-system-execute")
@tier("100")
@reason("System execution is unconditionally forbidden")
forbid (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when { resource has actionClass && resource.actionClass == "system.execute" };

@id("100-account-permission-change")
@tier("100")
@reason("Account permission changes are unconditionally forbidden")
forbid (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when { resource has actionClass && resource.actionClass == "account.permission.change" };

@id("100-unknown-sensitive-action")
@tier("100")
@reason("Unknown sensitive actions are unconditionally forbidden")
forbid (
  principal,
  action == OpenAuthority::Action::"RequestAccess",
  resource
)
when { resource has actionClass && resource.actionClass == "unknown_sensitive_action" };
