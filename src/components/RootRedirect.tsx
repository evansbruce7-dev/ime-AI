import { Navigate } from "react-router-dom";
import { readOnboardingComplete } from "../lib/prefs";

/**
 * Entry route `/`: send first-time users to onboarding, others to workspace home.
 */
export function RootRedirect() {
  const done = readOnboardingComplete();
  console.log("[router] root redirect onboardingComplete=", done);
  return <Navigate to={done ? "/home" : "/onboarding"} replace />;
}
