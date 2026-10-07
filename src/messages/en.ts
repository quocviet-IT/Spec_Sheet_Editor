import type { Messages } from "./index";

export const en: Messages = {
  app: {
    name: "Spec Sheet Editor",
    tagline: "Edit the dimension values on Product Specifications sheets",
  },
  common: {
    signOut: "Sign out",
    language: "Language",
    admin: "Admin",
    sheets: "Sheets",
  },
  login: {
    title: "Sign in",
    lead: "Use your company Google account.",
    google: "Sign in with Google",
    errors: {
      notPermitted: "This Google account is not in a permitted domain. Sign in with your company email.",
      suspended: "Your account has been suspended. Contact an administrator.",
      google: "Google sign-in did not complete. Try again.",
    },
  },
  sheets: {
    title: "Sheets",
    empty: "No sheets yet.",
  },
  admin: {
    title: "Admin",
    lead: "Only administrators can see this area.",
    areas: {
      users: "Users",
      access: "Access and settings",
      audit: "Audit log",
      cleanup: "Trash and clean-up",
    },
  },
};
