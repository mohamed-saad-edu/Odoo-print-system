import { TenantLifecycleError } from "./tenant-lifecycle";
import { TenantSuspendedError, TenantDeletedError } from "./tenant-guard";
import { WorkspaceSecurityRequestError } from "./workspace-session-http";
import { NextResponse } from "next/server";
import { ManualSubscriptionError } from "./manual-subscriptions";
import { PlatformUnauthorizedError, PlatformMutationAuthorityChangedError } from "./platform-auth";
import { ManagerMutationAuthorityChangedError } from "./manager-mutation-authorization";
export function manualApiError(error: unknown) {
  if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError) return NextResponse.json({error:error.message,code:error.code},{status:error.status,headers:{"Cache-Control":"private, no-store"}});
  if (error instanceof TenantLifecycleError) return NextResponse.json({error:error.code,code:error.code},{status:error.status});
  if (error instanceof WorkspaceSecurityRequestError) return NextResponse.json({error:error.code,code:error.code},{status:error.status});
  if (error instanceof ManualSubscriptionError) return NextResponse.json({error:error.code,code:error.code},{status:error.status});
  if (error instanceof PlatformUnauthorizedError) return NextResponse.json({error:"Unauthorized",code:"UNAUTHORIZED"},{status:401});
  if (error instanceof PlatformMutationAuthorityChangedError) return NextResponse.json({error:"Password confirmation required",code:"PLATFORM_REAUTH_REQUIRED"},{status:403});
  if (error instanceof ManagerMutationAuthorityChangedError) return error.response();
  return NextResponse.json({error:"Service unavailable",code:"MANUAL_SUBSCRIPTION_UNAVAILABLE"},{status:503});
}
