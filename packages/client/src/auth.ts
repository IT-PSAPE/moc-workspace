/** Authentication is owned by the API; no identity SDK or tokens in localStorage. */
export async function signInWithGoogle() {
  window.location.assign("/api/auth/google");
}

export const authErrorMessages: Record<string, string> = {
  cancelled: "Google sign-in was cancelled. Please try again.",
  expired: "Your sign-in attempt expired. Please continue with Google again.",
  denied: "This Google account is not an approved member. Contact Cell 0 for access.",
  unavailable: "Google sign-in is temporarily unavailable. Please try again.",
};
